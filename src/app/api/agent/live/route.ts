import { createHmac } from "crypto";
import { json, loadUserContext } from "@/lib/server-user";

/** A short-lived signed link to watch and control the agent's browser for one task (for human checks). */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { taskId } = (await req.json().catch(() => ({}))) as { taskId?: string };
  const { data: task } = await ctx.supabase.from("agent_tasks").select("id,status").eq("id", taskId || "").maybeSingle();
  if (!task) return json({ error: "Not found" }, 404);
  if (task.status !== "needs_human") return json({ error: "Live view opens only while your agent is waiting for a human check." }, 409);
  const base = process.env.WORKER_URL;
  if (!base || !process.env.AGENT_SECRET) return json({ error: "Live view isn't available yet." }, 503);
  const exp = Math.floor(Date.now() / 1000) + 12 * 60;
  const sig = createHmac("sha256", process.env.AGENT_SECRET).update(`${task.id}.${exp}`).digest("hex");
  return json({ url: `${base.replace(/\/$/, "")}/live/${task.id}`, token: `${exp}.${sig}` });
}
