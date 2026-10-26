import { json, loadUserContext } from "@/lib/server-user";
import { wakeWorker, workerState } from "@/lib/agent/svc";

export const maxDuration = 120;
const last = new Map<string, number>();

/** GET: is the agent's browser up? POST: start it now and work through the queue ("Apply now"). */
export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  return json(await workerState());
}

export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const prev = last.get(ctx.user.id) || 0;
  if (Date.now() - prev < 20_000) return json({ ok: true, throttled: true });
  last.set(ctx.user.id, Date.now());
  const { count } = await ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "queued");
  if (!count) return json({ ok: true, queued: 0 });
  const awake = await wakeWorker();
  return json({ ok: awake, queued: count });
}
