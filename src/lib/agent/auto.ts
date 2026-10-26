import "server-only";
import { ghostRisk } from "@/lib/jobs/ghost";
import { matchJob } from "@/lib/jobs/match";
import { searchVariants } from "@/lib/jobs/roles";
import { titleTsQuery } from "@/lib/jobs/engine";
import { normCompany } from "@/lib/jobs/signals";
import { dailyLimit, effectivePlan, PER_EMPLOYER_30D } from "@/lib/access";
import { prepareAndQueue } from "./prepare";
import { inPreferredPlace } from "@/lib/jobs/places";
import { rpc, wakeWorker } from "./svc";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

type AutoUser = {
  user_id: string; autonomy: string; daily_limit: number; high_volume_ok?: boolean | null; name: string | null; role?: string | null;
  prefs: TargetPrefs | null; roles: TargetRole[]; auth: WorkAuth[]; today: number; known_jobs: string[];
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
  for (const u of users) {
    if (Date.now() > deadline) break;
    // auto_users doesn't carry every setting; read the person's volume settings and recent employers.
    const lim = await supabaseAnon().rpc("agent_limits", { secret: ingestSecret(), p_user: u.user_id }).then((r) => (r.data as { daily_limit: number | null; high_volume_ok: boolean | null; employers: Record<string, number> } | null), () => null);
    const limit = dailyLimit({ daily_limit: lim?.daily_limit ?? u.daily_limit, high_volume_ok: lim?.high_volume_ok ?? u.high_volume_ok }, effectivePlan(null, u.role));
    const recentByEmployer = lim?.employers || {};
    const remaining = limit - (u.today || 0);
    if (remaining <= 0 || !u.roles.length) continue;
    const perRun = Math.min(remaining, 8);
    const known = new Set(u.known_jobs || []);
    const since = new Date(Date.now() - (u.prefs?.max_days_old || 14) * 864e5).toISOString();
    const phrases = [...new Set(u.roles.flatMap((r) => searchVariants(r.title, 10)))];
    const candidates: { job: Job; score: number; important: boolean; roleId?: string }[] = [];
    for (const country of (u.prefs?.countries?.length ? u.prefs.countries : ["US"]).slice(0, 6)) {
      const jobs = (await rpc<Job[]>("search", { country, tsquery: titleTsQuery(phrases), since, limit: 300 })) || [];
      await loadBoards(jobs.map((j) => boardOfJob(j.id)));
      const targets = new Set((u.prefs?.companies || []).map(normCompany));
      for (const job of jobs) {
        if (known.has(job.id)) continue;
        const info = boardInfo.get(boardOfJob(job.id));
        const vetted = Boolean(info) && !info!.added_by;
        const mine = Boolean(info) && targets.has(normCompany(info!.name));
        if (!vetted && !mine) continue;
        const m = matchJob(job, { roles: u.roles, prefs: u.prefs, auth: u.auth });
        if (!m.eligible || m.tooSenior || (m.roleFit ?? 0) < 0.55 || m.score < 58) continue;
        if (!inPreferredPlace(job, u.prefs)) continue;
        // Don't spend applications on likely ghost jobs (talent pools, months-old or never-answered postings).
        if (ghostRisk(job)?.level === "high") continue;
        const target = (u.prefs?.companies || []).some((c) => normCompany(c) === normCompany(job.company));
        candidates.push({ job, score: m.score + (target ? 15 : 0), important: target || m.score >= 85, roleId: m.role?.id });
      }
    }
    // One application per company per run keeps it human-paced and avoids flooding one employer.
    candidates.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    let made = 0;
    for (const c of candidates) {
      if (made >= perRun || Date.now() > deadline) break;
      const co = normCompany(c.job.company);
      if (seen.has(co)) continue;
      // Never more than a few applications to one employer in 30 days.
      if ((recentByEmployer[co] || 0) >= PER_EMPLOYER_30D) continue;
      seen.add(co);
      // "Approve every application" means exactly that, whatever the queue looks like.
      const status = u.autonomy === "approve_all" || (u.autonomy === "approve_important" && c.important) ? "awaiting_approval" : "queued";
      const r = await prepareAndQueue({ userId: u.user_id, name: u.name || "", job: c.job, roleId: c.roleId, match: c.score, status, priority: c.important ? 3 : 5 }).catch((e) => ({ taskCreated: false, error: String(e) }));
      if (r.taskCreated) made += 1;
    }
    summary[u.user_id] = made;
  }
  const q = await rpc<{ queued: number }>("queue_size", {});
  if (q?.queued) void wakeWorker();
  return { users: users.length, queued: summary, waiting: q?.queued || 0 };
}

export { inPreferredPlace } from "@/lib/jobs/places";
