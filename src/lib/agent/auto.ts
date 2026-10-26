import "server-only";
import { matchJob } from "@/lib/jobs/match";
import { searchVariants } from "@/lib/jobs/roles";
import { titleTsQuery } from "@/lib/jobs/engine";
import { normCompany } from "@/lib/jobs/signals";
import { effectivePlan } from "@/lib/access";
import { prepareAndQueue } from "./prepare";
import { inPreferredPlace } from "@/lib/jobs/places";
import { rpc, wakeWorker } from "./svc";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job, TargetPrefs, TargetRole, WorkAuth } from "@/lib/types";

type AutoUser = {
  user_id: string; autonomy: string; daily_limit: number; name: string | null;
  prefs: TargetPrefs | null; roles: TargetRole[]; auth: WorkAuth[]; today: number; known_jobs: string[];
};

/**
 * The agent's sourcing loop. For users on "fully automatic" or "approve important":
 * find the best new jobs they can legally take, prepare each one (tailored resume + letter) and queue it.
 * Important ones (target companies, top matches) wait for approval when the user asked for that.
 */
export async function autoSource(deadline: number) {
  const users = (await rpc<AutoUser[]>("auto_users", {})) || [];
  // Boards anyone can add go into the shared pool, so auto-apply only uses boards Vantage vetted, plus the user's own targets.
  const { data: boards } = await supabaseAnon().rpc("list_boards", { secret: ingestSecret() });
  const PREFIX: Record<string, string> = { greenhouse: "gh", lever: "lever", ashby: "ashby", smartrecruiters: "sr", workable: "wk", recruitee: "rc", workday: "wd", amazon: "amazon" };
  const boardRows = (boards as { ats: string; token: string; name: string; added_by?: string | null }[]) || [];
  const vetted = new Set(boardRows.filter((b) => !b.added_by).map((b) => `${PREFIX[b.ats]}:${b.token}`));
  const boardOfJob = (id: string) => id.split(":").slice(0, 2).join(":");
  const summary: Record<string, number> = {};
  for (const u of users) {
    if (Date.now() > deadline) break;
    const limit = Math.min(u.daily_limit || 25, effectivePlan().limits.autoApplyPerDay);
    const remaining = limit - (u.today || 0);
    if (remaining <= 0 || !u.roles.length) continue;
    const perRun = Math.min(remaining, 8);
    const known = new Set(u.known_jobs || []);
    const since = new Date(Date.now() - (u.prefs?.max_days_old || 14) * 864e5).toISOString();
    const phrases = [...new Set(u.roles.flatMap((r) => searchVariants(r.title, 10)))];
    const candidates: { job: Job; score: number; important: boolean; roleId?: string }[] = [];
    for (const country of (u.prefs?.countries?.length ? u.prefs.countries : ["US"]).slice(0, 6)) {
      const jobs = (await rpc<Job[]>("search", { country, tsquery: titleTsQuery(phrases), since, limit: 300 })) || [];
      const mine = new Set(boardRows.filter((b) => (u.prefs?.companies || []).some((c) => normCompany(c) === normCompany(b.name))).map((b) => `${PREFIX[b.ats]}:${b.token}`));
      for (const job of jobs) {
        if (known.has(job.id)) continue;
        if (!vetted.has(boardOfJob(job.id)) && !mine.has(boardOfJob(job.id))) continue;
        const m = matchJob(job, { roles: u.roles, prefs: u.prefs, auth: u.auth });
        if (!m.eligible || m.tooSenior || (m.roleFit ?? 0) < 0.55 || m.score < 58) continue;
        if (!inPreferredPlace(job, u.prefs)) continue;
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
      seen.add(co);
      const status = u.autonomy === "approve_important" && c.important ? "awaiting_approval" : "queued";
      const r = await prepareAndQueue({ userId: u.user_id, name: u.name || "", job: c.job, roleId: c.roleId, match: c.score, status, priority: c.important ? 3 : 5 }).catch((e) => ({ taskCreated: false, error: String(e) }));
      if (r.taskCreated) made += 1;
    }
    summary[u.user_id] = made;
  }
  const q = await rpc<{ queued: number }>("queue_size", {});
  if (q?.queued) wakeWorker();
  return { users: users.length, queued: summary, waiting: q?.queued || 0 };
}

export { inPreferredPlace } from "@/lib/jobs/places";
