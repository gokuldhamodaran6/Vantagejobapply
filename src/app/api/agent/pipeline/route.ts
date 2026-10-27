import { json, loadUserContext } from "@/lib/server-user";
import { keyOf, memo } from "@/lib/memo";
import { pipelineForUser } from "@/lib/jobs/engine";
import { dailyLimit, recentByEmployer } from "@/lib/access";
import { limitDayStart, roleKey } from "@/lib/agent/plan";

export const maxDuration = 60;

/**
 * "Matched & waiting": how many live jobs match each active target, how many the agent would apply to,
 * and how today's daily limit is split between targets. Read-only; never queues anything.
 */
export async function GET(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const started = Date.now();
  const dayStart = new Date(limitDayStart()).toISOString();
  const [tasks, apps, today, perEmployer] = await Promise.all([
    ctx.supabase.from("agent_tasks").select("job_id,job,status,submit_clicked_at").limit(10000),
    ctx.supabase.from("applications").select("job_id,job,applied_at").limit(10000),
    // Same rule as the agent: applications it actually started since midnight UTC (never ones you filled in your browser).
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).gte("created_at", dayStart).neq("status", "extension").not("started_at", "is", null),
    recentByEmployer(ctx.supabase),
  ]);
  type K = { job_id: string | null; job: { company: string; title: string } | null; status?: string; submit_clicked_at?: string | null; applied_at?: string | null };
  const rows = [...((tasks.data as K[]) || []), ...((apps.data as K[]) || [])];
  const known = new Set<string>(rows.map((r) => r.job_id || "").filter(Boolean));
  // A repost of a job already sent (new link, same company and title) is "handled" too.
  for (const r of rows) {
    const sent = r.applied_at || r.submit_clicked_at || ["submitted", "extension", "manual"].includes(r.status || "");
    if (sent && r.job) known.add(`role:${roleKey(r.job.company, r.job.title)}`);
  }
  const limit = dailyLimit(ctx.profile as { daily_limit?: number; high_volume_ok?: boolean }, ctx.plan);
  const usedToday = today.count || 0;
  try {
    const run = () => pipelineForUser(ctx.supabase, {
      roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, roleLimit: ctx.plan.limits.roles, countryLimit: ctx.plan.limits.countries,
      known, perEmployer, room: Math.max(0, limit - usedToday),
    });
    // Reused for 2 minutes while nothing changed (same targets, same jobs handled, same room today); Refresh asks afresh.
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const p = fresh ? await run() : await memo(keyOf("pipeline", ctx.user.id, ctx.roles, ctx.prefs, ctx.auth, known.size, usedToday, limit), 2 * 60_000, run);
    return json({ ...p, limit, usedToday, resetsAt: new Date(limitDayStart() + 864e5).toISOString(), tookMs: Date.now() - started });
  } catch (e) {
    console.error("pipeline failed", e);
    return json({ error: "Couldn't count your matches right now." }, 500);
  }
}
