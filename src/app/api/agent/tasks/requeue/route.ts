import { json, loadUserContext } from "@/lib/server-user";
import { wakeWorker } from "@/lib/agent/svc";

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
  const room = Math.max(0, ctx.plan.limits.autoApplyPerDay - (appliedToday || 0) - (inLine || 0));
  if (!room) return json({ error: `You've reached today's limit of ${ctx.plan.limits.autoApplyPerDay} applications. The rest can go tomorrow.` }, 429);
  let q = ctx.supabase.from("agent_tasks").select("id").in("status", ["cancelled", "failed"]).order("created_at", { ascending: false }).limit(room);
  if (body.ids?.length) q = q.in("id", body.ids.slice(0, 500));
  const { data: rows } = await q;
  const ids = (rows || []).map((r) => r.id as string);
  if (!ids.length) return json({ ok: true, queued: 0 });
  const { data: n, error } = await ctx.supabase.rpc("requeue_tasks", { p_ids: ids });
  if (error) return json({ error: error.message }, 500);
  void wakeWorker();
  return json({ ok: true, queued: n || 0, capped: ids.length === room && (rows || []).length === room });
}
