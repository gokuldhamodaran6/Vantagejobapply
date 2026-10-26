import { json, loadUserContext } from "@/lib/server-user";
import { wakeWorker } from "@/lib/agent/svc";

export const maxDuration = 90;
const last = new Map<string, number>();

/** The page asks for this when a job has waited in the queue too long: wake the browser worker now. */
export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const prev = last.get(ctx.user.id) || 0;
  if (Date.now() - prev < 30_000) return json({ ok: true, throttled: true });
  last.set(ctx.user.id, Date.now());
  const { count } = await ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "queued");
  if (!count) return json({ ok: true, queued: 0 });
  const awake = await wakeWorker();
  return json({ ok: awake, queued: count });
}
