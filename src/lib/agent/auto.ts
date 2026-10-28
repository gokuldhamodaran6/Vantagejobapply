import "server-only";
import { matchJob } from "@/lib/jobs/match";
import { searchVariants } from "@/lib/jobs/roles";
import { sharedSearch, titleTsQuery } from "@/lib/jobs/engine";
import { normCompany } from "@/lib/jobs/signals";
import { dailyLimit, effectivePlan, PER_EMPLOYER_30D } from "@/lib/access";
import { prepareAndQueue } from "./prepare";
import { autoSkipReason, DEFAULT_FRESH_DAYS, interleaveByPriority, roleKey, taskPriority } from "./plan";
import { rpc, wakeWorker } from "./svc";
import { runNow, type AutoSchedule } from "./schedule";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

type AutoUser = {
  user_id: string; autonomy: string; daily_limit: number; high_volume_ok?: boolean | null; name: string | null; role?: string | null;
  prefs: TargetPrefs | null; roles: TargetRole[]; auth: WorkAuth[]; today: number; known_jobs: string[]; known_roles?: string[];
};



/**
 * The agent's sourcing loop. For users on "fully automatic" or "approve important":
 * find the best new jobs they can legally take, prepare each one (tailored resume + letter) and queue it.
 * Important ones (target companies, top matches) wait for approval when the user asked for that.
 */
export async function autoSource(deadline: number) {
  const users = (await rpc<AutoUser[]>("auto_users", {})) || [];
  // Boards anyone can add go into the shared pool, so auto-apply only uses boards Vantage found itself, plus the user's own targets.
  const boardOfJob = (id: string) => id.split(":").slice(0, 2).join(":");
  const boardInfo = new Map<string, { added_by: string | null; name: string }>();
  async function loadBoards(keys: string[]) {
    const missing = [...new Set(keys)].filter((k) => !boardInfo.has(k));
    if (!missing.length) return;
    const { data } = await supabaseAnon().rpc("board_info", { secret: ingestSecret(), keys: missing });
    for (const r of (data as { key: string; added_by: string | null; name: string }[]) || []) boardInfo.set(r.key, r);
  }
  const summary: Record<string, number> = {};
  // What each run saw and why it skipped, so "queued nothing" can be explained (returned to the cron log).
  const detail: Record<string, { searched: number; candidates: number; skipped: Record<string, number>; errors: string[] }> = {};
  for (const u of users) {
    if (Date.now() > deadline) break;
    // auto_users doesn't carry every setting; read the person's volume settings and recent employers.
    const lim = await supabaseAnon().rpc("agent_limits", { secret: ingestSecret(), p_user: u.user_id }).then((r) => (r.data as { daily_limit: number | null; high_volume_ok: boolean | null; employers: Record<string, number>; schedule?: AutoSchedule } | null), () => null);
    // Their schedule: set times (in their own time zone) and quiet hours. Outside it, this run doesn't look for jobs.
    const when = runNow(lim?.schedule || null, Date.now());
    if (!when.run) { detail[u.user_id] = { searched: 0, candidates: 0, skipped: { "Not a scheduled time": 1 }, errors: [] }; continue; }
    const limit = dailyLimit({ daily_limit: lim?.daily_limit ?? u.daily_limit, high_volume_ok: lim?.high_volume_ok ?? u.high_volume_ok }, effectivePlan(null, u.role));
    const recentByEmployer = lim?.employers || {};
    const remaining = limit - (u.today || 0);
    if (remaining <= 0 || !u.roles.length) continue;
    // With set times, today's remaining applications are spread over the runs still to come.
    const perRun = Math.min(remaining, Math.max(1, Math.ceil(remaining / when.runsLeft)), when.runsLeft > 1 || lim?.schedule ? 15 : 8);
    const known = new Set(u.known_jobs || []);
    const sentRoles = new Set(u.known_roles || []);
    const since = new Date(Date.now() - (u.prefs?.max_days_old || DEFAULT_FRESH_DAYS) * 864e5).toISOString();
    const candidates: { job: Job; score: number; important: boolean; roleId?: string; rolePriority?: number }[] = [];
    const d = (detail[u.user_id] = { searched: 0, candidates: 0, skipped: {} as Record<string, number>, errors: [] as string[] });
    const skip = (k: string) => (d.skipped[k] = (d.skipped[k] || 0) + 1);
    for (const country of (u.prefs?.countries?.length ? u.prefs.countries : ["US"]).slice(0, 6)) {
      // One small search per target role: each stays well inside the database's 3 s limit for server calls, and a
      // slow one (or a slow country) never stops the rest — a single combined search used to time out every run.
      const byId = new Map<string, Job>();
      // The same search as the person's "Matched & waiting" panel, so "Up next" is what the agent really takes.
      const active = u.roles.filter((r) => r.active);
      const all = await sharedSearch(country, [...new Set(active.flatMap((r) => searchVariants(r.title, 10)))],
        (c, tsquery, from) => rpc<Job[]>("search", { country: c, tsquery, since: from, limit: 900 }).then((x) => x || []))
        .then((x) => x.data as Job[]).catch((e) => { d.errors.push(`search: ${String(e).slice(0, 80)}`); return null; });
      if (all) for (const j of all) byId.set(j.id, j);
      else {
        // Fallback: one small search per target role (each well inside the database's time limit).
        for (const r of u.roles) {
          const got = await rpc<Job[]>("search", { country, tsquery: titleTsQuery(searchVariants(r.title, 10)), since, limit: 200 })
            .catch((e) => { d.errors.push(`search ${r.title}: ${String(e).slice(0, 80)}`); return null; });
          for (const j of got || []) if (!byId.has(j.id)) byId.set(j.id, j);
        }
      }
      const jobs = [...byId.values()];
      d.searched += jobs.length;
      await loadBoards(jobs.map((j) => boardOfJob(j.id)));
      const targets = new Set((u.prefs?.companies || []).map(normCompany));
      for (const job of jobs) {
        if (known.has(job.id) || sentRoles.has(roleKey(job.company, job.title))) { skip("Already handled"); continue; }
        const info = boardInfo.get(boardOfJob(job.id));
        const vetted = Boolean(info) && !info!.added_by;
        const mine = Boolean(info) && targets.has(normCompany(info!.name));
        if (!vetted && !mine) { skip("Careers site not verified yet"); continue; }
        const m = matchJob(job, { roles: u.roles, prefs: u.prefs, auth: u.auth });
        // Same rules the "Matched & waiting" panel explains: eligible, close fit, in your places and arrangement,
        // fresh enough, and never likely ghost jobs (talent pools, months-old or never-answered postings).
        const why = autoSkipReason(job, m, u.prefs, { vetted: true });
        if (why) { skip(why); continue; }
        const target = (u.prefs?.companies || []).some((c) => normCompany(c) === normCompany(job.company));
        candidates.push({ job, score: m.score + (target ? 15 : 0), important: target || m.score >= 85, roleId: m.role?.id, rolePriority: m.role?.priority });
      }
    }
    // Every target gets its turn, weighted by its priority (Top 3 : High 2 : Normal 1), best matches first within each.
    // One application per company per run keeps it human-paced and avoids flooding one employer.
    const ordered = interleaveByPriority(candidates, u.roles);
    const seen = new Set<string>();
    let made = 0;
    for (const c of ordered) {
      if (made >= perRun || Date.now() > deadline) break;
      const co = normCompany(c.job.company);
      if (seen.has(co)) continue;
      // Never more than a few applications to one employer in 30 days.
      if ((recentByEmployer[co] || 0) >= PER_EMPLOYER_30D) continue;
      seen.add(co);
      // "Approve every application" means exactly that, whatever the queue looks like.
      const status = u.autonomy === "approve_all" || (u.autonomy === "approve_important" && c.important) ? "awaiting_approval" : "queued";
      const r = await prepareAndQueue({ userId: u.user_id, name: u.name || "", job: c.job, roleId: c.roleId, match: c.score, status, priority: taskPriority(c.important, c.rolePriority) }).catch((e) => ({ taskCreated: false, error: String(e) }));
      if (r.taskCreated) made += 1;
      else d.errors.push(`${c.job.company}: ${String(r.error || "not created").slice(0, 120)}`);
    }
    summary[u.user_id] = made;
    d.candidates = candidates.length;
  }
  const q = await rpc<{ queued: number }>("queue_size", {});
  if (q?.queued) void wakeWorker();
  return { users: users.length, queued: summary, waiting: q?.queued || 0, detail };
}

export { inPreferredPlace } from "@/lib/jobs/places";
