import { json, loadUserContext } from "@/lib/server-user";
import { wakeWorker } from "@/lib/agent/svc";
import { dailyLimit, PER_EMPLOYER_30D, recentByEmployer } from "@/lib/access";
import { normCompany } from "@/lib/jobs/signals";

/**
 * Put cancelled or unfinished jobs back in line in one go ("Apply to all again").
 * Capped by what's left of today's application limit, newest jobs first.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [{ count: appliedToday }, { count: inLine }] = await Promise.all([
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "submitted").gte("finished_at", today.toISOString()),
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).in("status", ["queued", "running", "waiting_code", "needs_human"]),
  ]);
  const limit = dailyLimit(ctx.profile as { daily_limit?: number; high_volume_ok?: boolean }, ctx.plan);
  const room = Math.max(0, limit - (appliedToday || 0) - (inLine || 0));
  if (!room) return json({ error: `You've reached today's limit of ${limit} applications. The rest can go tomorrow — or raise your daily limit in Settings.` }, 429);
  let q = ctx.supabase.from("agent_tasks").select("id,job_id,job").in("status", ["cancelled", "failed"]).order("created_at", { ascending: false }).limit(room);
  if (body.ids?.length) q = q.in("id", body.ids.slice(0, 500));
  const { data: rows } = await q;
  // Skip jobs that were already sent (same posting, or the same title at the same company).
  const { data: sent } = await ctx.supabase.from("agent_tasks").select("job_id,job").eq("status", "submitted").limit(5000);
  const sentKey = new Set((sent || []).flatMap((t) => [t.job_id as string, `${(t.job as { company: string }).company}|${(t.job as { title: string }).title}`.toLowerCase()]));
  // Same per-employer cap as the agent: at most a few applications to one company in 30 days.
  const perEmployer = await recentByEmployer(ctx.supabase);
  const ids = (rows || [])
    .filter((r) => !sentKey.has(r.job_id as string) && !sentKey.has(`${(r.job as { company: string }).company}|${(r.job as { title: string }).title}`.toLowerCase()))
    .filter((r) => {
      const co = normCompany((r.job as { company: string }).company);
      const n = perEmployer.get(co) || 0;
      if (n >= PER_EMPLOYER_30D) return false;
      perEmployer.set(co, n + 1);
      return true;
    })
    .map((r) => r.id as string);
  if (!ids.length) return json({ ok: true, queued: 0 });
  const { data: n, error } = await ctx.supabase.rpc("requeue_tasks", { p_ids: ids });
  if (error) return json({ error: error.message }, 500);
  void wakeWorker();
  return json({ ok: true, queued: n || 0, capped: ids.length === room && (rows || []).length === room });
}
