import { json, loadUserContext } from "@/lib/server-user";
import { pipelineForUser } from "@/lib/jobs/engine";
import { dailyLimit, recentByEmployer } from "@/lib/access";
import { limitDayStart } from "@/lib/agent/plan";

export const maxDuration = 60;

/**
 * "Matched & waiting": how many live jobs match each active target, how many the agent would apply to,
 * and how today's daily limit is split between targets. Read-only; never queues anything.
 */
export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const started = Date.now();
  const dayStart = new Date(limitDayStart()).toISOString();
  const [tasks, apps, today, perEmployer] = await Promise.all([
    ctx.supabase.from("agent_tasks").select("job_id").limit(10000),
    ctx.supabase.from("applications").select("job_id").not("job_id", "is", null).limit(10000),
    // The database counts the day's applications from midnight UTC, by when each task was created.
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    recentByEmployer(ctx.supabase),
  ]);
  const known = new Set<string>([...(tasks.data || []), ...(apps.data || [])].map((r) => (r as { job_id: string }).job_id).filter(Boolean));
  const limit = dailyLimit(ctx.profile as { daily_limit?: number; high_volume_ok?: boolean }, ctx.plan);
  const usedToday = today.count || 0;
  try {
    const p = await pipelineForUser(ctx.supabase, {
      roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, roleLimit: ctx.plan.limits.roles, countryLimit: ctx.plan.limits.countries,
      known, perEmployer, room: Math.max(0, limit - usedToday),
    });
    return json({ ...p, limit, usedToday, resetsAt: new Date(limitDayStart() + 864e5).toISOString(), tookMs: Date.now() - started });
  } catch (e) {
    console.error("pipeline failed", e);
    return json({ error: "Couldn't count your matches right now." }, 500);
  }
}
