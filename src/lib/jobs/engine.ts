import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBoard, type Board } from "./sources";
import { matchJob } from "./match";
import { normCompany } from "./signals";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job, MatchResult, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

let sponsorCountries: { at: number; value: Set<string> } | null = null;
const inflight = new Map<number, Promise<number>>();

export async function storeJobs(jobs: Job[]) {
  if (!jobs.length) return 0;
  const supa = supabaseAnon();
  let total = 0;
  for (let i = 0; i < jobs.length; i += 300) {
    const chunk = jobs.slice(i, i + 300).map((j) => ({ ...j, description: (j.description || "").slice(0, 15000) }));
    const { data, error } = await supa.rpc("ingest_jobs", { secret: ingestSecret(), rows: chunk });
    if (error) console.error("ingest_jobs failed", error.message);
    else total += (data as number) || 0;
  }
  return total;
}

/** Fetch one employer feed and store it. De-duplicates concurrent refreshes. */
export function refreshBoard(b: Board & { id: number }): Promise<number> {
  const existing = inflight.get(b.id);
  if (existing) return existing;
  const p = (async () => {
    const supa = supabaseAnon();
    try {
      const jobs = await fetchBoard(b);
      if (!jobs) {
        await supa.rpc("board_status", { secret: ingestSecret(), p_id: b.id, p_count: 0, p_error: "feed not reachable" });
        return 0;
      }
      await storeJobs(jobs);
      await supa.rpc("board_status", { secret: ingestSecret(), p_id: b.id, p_count: jobs.length, p_error: null });
      return jobs.length;
    } finally {
      inflight.delete(b.id);
    }
  })();
  inflight.set(b.id, p);
  return p;
}

async function loadedSponsorCountries(supabase: SupabaseClient): Promise<Set<string>> {
  if (sponsorCountries && Date.now() - sponsorCountries.at < 60 * 60 * 1000) return sponsorCountries.value;
  const set = new Set<string>();
  for (const c of ["GB", "US", "CA"]) {
    const { count } = await supabase.from("sponsors").select("id", { count: "exact", head: true }).eq("country", c);
    if ((count || 0) > 1000) set.add(c);
  }
  sponsorCountries = { at: Date.now(), value: set };
  return set;
}

const SWAPS: [RegExp, string][] = [
  [/\bengineer\b/i, "developer"], [/\bdeveloper\b/i, "engineer"], [/\banalyst\b/i, "analytics"],
  [/\bhgv\b/i, "lgv"], [/\btruck driver\b/i, "cdl driver"], [/\bregistered nurse\b/i, "rn"], [/\bnurse\b/i, "nursing"],
  [/\bux designer\b/i, "product designer"], [/\bsoftware\b/i, "backend"],
];
/** Title plus a few common variants, so "Software Engineer" also finds "Software Developer". */
export function titleVariants(title: string): string[] {
  const out = [title];
  for (const [re, rep] of SWAPS) if (re.test(title)) out.push(title.replace(re, rep));
  return [...new Set(out.map((t) => t.trim()))].slice(0, 3);
}

function toQuery(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1).join(" ");
}

export type SearchInput = {
  country: string;
  q?: string;
  roleId?: string;
  city?: string;
  remoteOnly?: boolean;
  maxDaysOld?: number;
  showBlocked?: boolean;
};

export type ScoredJob = { job: Job; match: MatchResult };

const JOB_COLS = "id,source,country,title,company,location,remote,description,url,salary_min,salary_max,currency,category,contract_time,posted_at,sponsorship,sponsor_registered,restrictions";

export async function searchForUser(
  supabase: SupabaseClient,
  ctx: { roles: TargetRole[]; prefs: TargetPrefs | null; auth: WorkAuth[]; roleLimit: number },
  input: SearchInput,
) {
  const country = input.country.toUpperCase();
  const maxDays = input.maxDaysOld ?? 60;
  const activeRoles = ctx.roles.filter((r) => r.active).slice(0, ctx.roleLimit);
  const roles = input.roleId ? activeRoles.filter((r) => r.id === input.roleId) : activeRoles;
  const queries = input.q ? [input.q] : [...new Set(roles.flatMap((r) => titleVariants(r.title)))];
  if (!queries.length) return { results: [] as ScoredJob[], meta: { sources: {}, hidden: 0, total: 0, refreshed: 0, sponsorCheck: false } };

  // 1) Keep target companies real-time: refresh their feeds if older than 20 minutes.
  let refreshed = 0;
  const targets = (ctx.prefs?.companies || []).map(normCompany).filter(Boolean);
  if (targets.length) {
    const { data: boards } = await supabase.from("boards").select("*").in("name_norm", targets).eq("active", true);
    const stale = ((boards as (Board & { id: number; last_ok_at: string | null })[]) || []).filter(
      (b) => !b.last_ok_at || Date.now() - Date.parse(b.last_ok_at) > 20 * 60 * 1000,
    );
    if (stale.length) {
      const budget = new Promise<void>((r) => setTimeout(r, 6000));
      await Promise.race([Promise.all(stale.slice(0, 6).map((b) => refreshBoard(b).then((n) => (refreshed += n)))), budget]);
    }
  }

  // 2) Search stored jobs from official employer feeds.
  const since = new Date(Date.now() - maxDays * 864e5).toISOString();
  const tasks = queries.slice(0, 9).map((q) =>
    supabase
      .from("jobs")
      .select(JOB_COLS)
      .eq("country", country)
      .neq("source", "adzuna")
      .or(`posted_at.gte."${since}",posted_at.is.null`)
      .textSearch("fts", toQuery(q), { type: "websearch", config: "english" })
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(250),
  );
  const [dbRes, sponsorsLoaded] = await Promise.all([Promise.all(tasks), loadedSponsorCountries(supabase)]);

  const byKey = new Map<string, Job>();
  dbRes.forEach((r) =>
    ((r.data as Job[] | null) || []).forEach((j) => {
      const k = `${normCompany(j.company)}|${j.title.toLowerCase().trim()}|${(j.location || "").toLowerCase().split(",")[0]}`;
      if (!byKey.has(k)) byKey.set(k, j);
    }),
  );

  let hidden = 0;
  const sources: Record<string, number> = {};
  const results: ScoredJob[] = [];
  const cities = (ctx.prefs?.locations || []).filter((l) => l.country === country).map((l) => l.city.toLowerCase());
  for (const job of byKey.values()) {
    if (input.remoteOnly && !job.remote) continue;
    if (input.city && !(job.location || "").toLowerCase().includes(input.city.toLowerCase())) continue;
    sources[job.source] = (sources[job.source] || 0) + 1;
    const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, sponsorsLoaded });
    if (!match.eligible) hidden += 1;
    if (!match.eligible && !input.showBlocked) continue;
    if (!input.q && match.score < 30) continue;
    // If the user picked cities, keep jobs in those cities, remote, or anywhere when the location is unknown.
    if (cities.length && !input.city && !job.remote && job.location && !cities.some((c) => job.location!.toLowerCase().includes(c)) && match.score < 70) continue;
    results.push({ job, match });
  }
  results.sort((a, b) => b.match.score - a.match.score || (Date.parse(b.job.posted_at || "") || 0) - (Date.parse(a.job.posted_at || "") || 0));

  return {
    results: results.slice(0, 150),
    meta: { sources, hidden, total: byKey.size, refreshed, sponsorCheck: sponsorsLoaded.has(country) },
  };
}
