import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { fetchBoard, fetchDescription, type Board } from "@/lib/jobs/sources";
import { refreshBoard, storeJobs } from "@/lib/jobs/engine";
import { analyzeText, normCompany } from "@/lib/jobs/signals";
import { parseCsv } from "@/lib/csv";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { json } from "@/lib/server-user";
import type { Job } from "@/lib/types";

export const maxDuration = 300;

function authorized(req: NextRequest) {
  const want = process.env.INGEST_SECRET || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function ingestBoards(deadline: number) {
  const supa = supabaseAnon();
  const { data, error } = await supa.rpc("list_boards", { secret: ingestSecret() });
  if (error) return { error: error.message };
  const queue = [...((data as (Board & { id: number })[]) || [])];
  const results: Record<string, number> = {};
  async function worker() {
    while (queue.length && Date.now() < deadline) {
      const b = queue.shift()!;
      results[`${b.ats}:${b.token}`] = await refreshBoard(b).catch(() => -1);
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  return { boards: Object.keys(results).length, remaining: queue.length, results };
}

/** Fill in descriptions for feeds whose list endpoint omits them (Workday, SmartRecruiters). */
async function enrichDescriptions(deadline: number, limit = 60) {
  const supa = supabaseAnon();
  const { data: boards } = await supa.rpc("list_boards", { secret: ingestSecret() });
  const byToken = new Map<string, Board>(((boards as Board[]) || []).map((b) => [`${b.ats === "smartrecruiters" ? "sr" : b.ats === "workday" ? "wd" : b.ats}:${b.token}`, b]));
  let done = 0;
  const pending: Job[] = [];
  for (const b of byToken.values()) {
    if (b.ats !== "workday" && b.ats !== "smartrecruiters") continue;
    // Enrich the newest postings from this employer.
    const jobs = ((await fetchBoard(b)) || []).sort((a, z) => (Date.parse(z.posted_at || "") || 0) - (Date.parse(a.posted_at || "") || 0)).slice(0, 15);
    for (const j of jobs) {
      if (Date.now() > deadline || done >= limit) break;
      const d = await fetchDescription(j, b);
      if (d) {
        const s = analyzeText(j.title, d);
        pending.push({ ...j, description: d, sponsorship: s.sponsorship, restrictions: s.restrictions, remote: j.remote || s.remote });
        done++;
      }
    }
  }
  await storeJobs(pending);
  return { enriched: done };
}

async function ingestUkSponsors() {
  const meta = await fetch("https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!meta.ok) return { error: `content api ${meta.status}` };
  const body = (await meta.json()) as { details?: { attachments?: { url?: string }[] } };
  const csvUrl = body.details?.attachments?.find((a) => (a.url || "").toLowerCase().endsWith(".csv"))?.url;
  if (!csvUrl) return { error: "csv link not found" };
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) return { error: `csv ${res.status}` };
  const rows = parseCsv(await res.text());
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) || [];
  const iName = header.findIndex((h) => h.startsWith("organisation"));
  const iCity = header.findIndex((h) => h.startsWith("town"));
  const iRoute = header.findIndex((h) => h === "route");
  if (iName < 0) return { error: "unexpected columns", header };
  const merged = new Map<string, { name: string; city: string; route: string }>();
  for (const r of rows) {
    const name = (r[iName] || "").trim();
    const key = normCompany(name);
    if (!key) continue;
    const route = (r[iRoute] || "").trim();
    const prev = merged.get(key);
    if (prev) {
      if (route && !prev.route.includes(route)) prev.route = `${prev.route}; ${route}`.slice(0, 300);
    } else merged.set(key, { name, city: (r[iCity] || "").trim(), route });
  }
  const supa = supabaseAnon();
  const all = [...merged.values()];
  let stored = 0;
  for (let i = 0; i < all.length; i += 2000) {
    const { data, error } = await supa.rpc("ingest_sponsors", { secret: ingestSecret(), p_country: "GB", p_source: "uk_register", rows: all.slice(i, i + 2000) });
    if (error) return { error: error.message, stored };
    stored += (data as number) || 0;
  }
  await supa.rpc("refresh_sponsor_flags", { secret: ingestSecret() });
  return { csv: csvUrl, organisations: all.length, stored };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const task = req.nextUrl.searchParams.get("task") || "boards";
  const started = Date.now();
  const deadline = started + 240_000;
  const out: Record<string, unknown> = { task };
  try {
    if (task === "boards" || task === "all") out.boards = await ingestBoards(deadline);
    if (task === "enrich" || task === "all") out.enrich = await enrichDescriptions(deadline);
    if (task === "uk_sponsors" || task === "all") out.uk = await ingestUkSponsors();
    if (task === "discover") {
      const { discover } = await import("@/lib/jobs/discovery");
      out.discover = await discover(deadline);
    }
    if (task === "agent") {
      const { syncAll } = await import("@/lib/agent/mailsync");
      const { autoSource } = await import("@/lib/agent/auto");
      const { refreshTargets } = await import("@/lib/jobs/discovery");
      out.targets = await refreshTargets(started + 60_000).catch((e) => ({ error: String(e) }));
      out.mail = await syncAll(started + 90_000).catch((e) => ({ error: String(e) }));
      out.auto = await autoSource(deadline).catch((e) => ({ error: String(e) }));
    }
    if (task === "prune" || task === "all") out.pruned = (await supabaseAnon().rpc("prune_jobs", { secret: ingestSecret(), days: 45 })).data;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  out.ms = Date.now() - started;
  return json(out);
}

export const GET = POST;
