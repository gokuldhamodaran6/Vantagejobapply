import "server-only";
import { companyKey, ghostRisk, type CompanyReplies, type GhostRisk } from "./ghost";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_READABLE, fetchBoard, fetchDescription, type Board } from "./sources";
import { matchJob } from "./match";
import { analyzeText, normCompany } from "./signals";
import { searchVariants } from "./roles";
import { inPreferredPlace } from "./places";
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
    let res = await supa.rpc("ingest_jobs", { secret: ingestSecret(), rows: chunk });
    if (res.error) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await supa.rpc("ingest_jobs", { secret: ingestSecret(), rows: chunk });
    }
    const { data, error } = res;
    if (error) console.error("ingest_jobs failed", error.message);
    else total += (data as number) || 0;
  }
  return total;
}

/** Ask the database crawler to read these boards on its next tick (about 20 seconds). */
export async function crawlNow(ids: number[]) {
  if (!ids.length) return 0;
  const { data } = await supabaseAnon().rpc("crawl_now", { secret: ingestSecret(), ids });
  return (data as number) || 0;
}

/**
 * Read one employer feed. The database crawler keeps every board current on its own; this is for
 * the moments a user is waiting (adding a company), where it also fetches right away so jobs show instantly.
 */
export function refreshBoard(b: Board & { id: number }, opts: { now?: boolean } = {}): Promise<number> {
  if (b.ats !== "amazon" && (!opts.now || !APP_READABLE.has(b.ats))) return crawlNow([b.id]);
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
      if (b.ats !== "amazon") await crawlNow([b.id]).catch(() => 0);
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

/** Title plus a few common variants, so "Software Engineer" also finds "Software Developer". */
export function titleVariants(title: string): string[] {
  return searchVariants(title, 3);
}

/** Build a title-weighted OR query: each phrase must appear in the job title, in order. */
export function titleTsQuery(phrases: string[]): string {
  const parts = phrases
    .map((p) => p.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !TS_STOP.has(w)))
    .filter((ws) => ws.length)
    .map((ws) => (ws.length === 1 ? `${ws[0]}:A` : `(${ws.map((w) => `${w}:A`).join(" <-> ")})`));
  return [...new Set(parts)].join(" | ");
}
const TS_STOP = new Set(["and", "or", "the", "of", "a", "an", "for", "to", "in", "with", "at", "on", "by", "is", "be", "as"]);

export type SearchInput = {
  country: string;
  q?: string;
  roleId?: string;
  city?: string;
  remoteOnly?: boolean;
  maxDaysOld?: number;
  showBlocked?: boolean;
};

export type ScoredJob = { job: Job; match: MatchResult; ghost?: GhostRisk };
export type LiveStats = { open_jobs?: number; companies?: number; boards_live?: number; boards_known?: number; systems?: number; new_24h?: number; updated_at?: string };

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
  const phrases = input.q ? searchVariants(input.q, 6) : [...new Set(roles.flatMap((r) => searchVariants(r.title, 10)))];
  if (!phrases.length) return { results: [] as ScoredJob[], meta: { sources: {}, hidden: 0, hiddenBy: {}, total: 0, refreshed: 0, sponsorCheck: false } };

  // 1) Target companies stay near real-time: the crawler reads them every 15 minutes; nudge any that are older.
  let refreshed = 0;
  const targets = (ctx.prefs?.companies || []).map(normCompany).filter(Boolean);
  if (targets.length) {
    const { data: boards } = await supabase.from("boards").select("id,last_ok_at").in("name_norm", targets).eq("active", true);
    const stale = ((boards as { id: number; last_ok_at: string | null }[]) || []).filter(
      (b) => !b.last_ok_at || Date.now() - Date.parse(b.last_ok_at) > 15 * 60 * 1000,
    );
    if (stale.length) refreshed = await crawlNow(stale.map((b) => b.id)).catch(() => 0);
  }

  // 2) One ranked, title-weighted search over open jobs read from official employer feeds.
  const since = new Date(Date.now() - maxDays * 864e5).toISOString();
  const [dbRes, sponsorsLoaded, statsRes, liveRes] = await Promise.all([
    supabase.rpc("search_jobs2", { p_country: country, p_tsquery: titleTsQuery(phrases), p_since: since, p_limit: 900 }),
    loadedSponsorCountries(supabase),
    supabase.rpc("company_reply_stats").then((r) => r, () => ({ data: null })),
    supabase.rpc("job_stats").then((r) => r, () => ({ data: null })),
  ]);
  const replies = new Map(((statsRes.data as ({ company: string } & CompanyReplies)[] | null) || []).map((s) => [s.company, s]));
  const copies = new Map<string, number>();
  if (dbRes.error) throw new Error(dbRes.error.message);

  const byKey = new Map<string, Job>();
  ((dbRes.data as (Job & { first_seen_at?: string; reposts?: number })[] | null) || []).forEach((j) => {
    if (j.source === "adzuna") return;
    const ck = `${normCompany(j.company)}|${j.title.toLowerCase().trim()}`;
    copies.set(ck, (copies.get(ck) || 0) + 1);
    const k = `${normCompany(j.company)}|${j.title.toLowerCase().trim()}|${(j.location || "").toLowerCase().split(",")[0]}`;
    if (!byKey.has(k)) byKey.set(k, j);
  });

  let hidden = 0;
  const hiddenBy: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const results: ScoredJob[] = [];
  const hasPlaces = (ctx.prefs?.locations || []).some((l) => l.country === country);
  for (const job of byKey.values()) {
    if (input.remoteOnly && !job.remote) continue;
    if (input.city && !(job.location || "").toLowerCase().includes(input.city.toLowerCase())) continue;
    sources[job.source] = (sources[job.source] || 0) + 1;
    const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, sponsorsLoaded });
    const hideReason = !match.eligible ? hiddenCategory(match.blockers[0]) : match.tooSenior && !input.showBlocked && !input.q ? "Too senior for your levels" : null;
    if (hideReason) {
      hidden += 1;
      hiddenBy[hideReason] = (hiddenBy[hideReason] || 0) + 1;
      if (!input.showBlocked) continue;
    }
    if (!input.q && (match.roleFit ?? 1) < 0.45) continue;
    if (!input.q && match.score < 30) continue;
    // If the user picked cities, keep jobs in those cities, remote, or anywhere when the location is unknown.
    if (hasPlaces && !input.city && !inPreferredPlace(job, ctx.prefs) && match.score < 70) continue;
    const ghost = ghostRisk(job, { replies: replies.get(companyKey(job.company)) || null, copies: copies.get(`${normCompany(job.company)}|${job.title.toLowerCase().trim()}`), reposts: (job as { reposts?: number }).reposts || 0 });
    results.push({ job, match, ghost });
  }
  // Workday lists carry no descriptions. Fill them in for the best matches so visa and skill checks see the full text.
  const needText = results.filter((r) => !r.job.description && r.job.source === "workday").sort((a, b) => b.match.score - a.match.score).slice(0, 10);
  if (needText.length) {
    const budget = new Promise<void>((r) => setTimeout(r, 4000));
    await Promise.race([
      Promise.all(needText.map(async (r) => {
        const b = workdayBoardOf(r.job);
        const d = b ? await fetchDescription(r.job, b).catch(() => null) : null;
        if (!d) return;
        const sig = analyzeText(r.job.title, d);
        r.job = { ...r.job, description: d, sponsorship: sig.sponsorship, restrictions: sig.restrictions, remote: r.job.remote || sig.remote };
        r.match = matchJob(r.job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, sponsorsLoaded });
        void supabaseAnon().rpc("set_job_description", { secret: ingestSecret(), p_id: r.job.id, p_description: d }).then(() => {}, () => {});
      })),
      budget,
    ]);
  }
  for (let i = results.length - 1; i >= 0; i--) {
    if (!results[i].match.eligible && !input.showBlocked) { results.splice(i, 1); hidden += 1; }
  }

  // Likely ghost jobs sink to the bottom; they stay visible (in red) so the user knows why.
  const sink = (x: ScoredJob) => (x.ghost?.level === "high" ? 2 : x.ghost ? 1 : 0);
  results.sort((a, b) => sink(a) - sink(b) || b.match.score - a.match.score || (Date.parse(b.job.posted_at || "") || 0) - (Date.parse(a.job.posted_at || "") || 0));

  return {
    results: results.slice(0, 200),
    meta: { sources, hidden, hiddenBy, total: byKey.size, refreshed, sponsorCheck: sponsorsLoaded.has(country), live: (liveRes.data as LiveStats | null) || null },
  };
}

/** Rebuild a Workday board from a job link: https://{host}/en-US/{site}/job/... */
function workdayBoardOf(job: Job): Board | null {
  try {
    const u = new URL(job.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || "") ? parts[1] : parts[0];
    const token = job.id.split(":")[1];
    return site && token ? { ats: "workday", token, host: u.host, site, name: job.company } : null;
  } catch {
    return null;
  }
}

function hiddenCategory(blocker: string | undefined): string {
  const b = (blocker || "").toLowerCase();
  if (b.includes("sponsor-only")) return "Don't confirm sponsorship";
  if (b.includes("can't sponsor") || b.includes("won't sponsor")) return "Say they won't sponsor";
  if (b.includes("citizens") || b.includes("residents")) return "Citizens or residents only";
  if (b.includes("clearance")) return "Need security clearance";
  if (b.includes("register")) return "Not a licensed sponsor";
  if (b.includes("never-apply")) return "On your never-apply list";
  return "Other visa rules";
}
