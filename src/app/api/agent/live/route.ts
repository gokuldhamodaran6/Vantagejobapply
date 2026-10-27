import { createHmac } from "crypto";
import { json, loadUserContext } from "@/lib/server-user";

/** A short-lived signed link to watch and control the agent's browser for one task (the in-app browser). */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { taskId } = (await req.json().catch(() => ({}))) as { taskId?: string };
  const { data: task } = await ctx.supabase.from("agent_tasks").select("id,status,user_input").eq("id", taskId || "").maybeSingle();
  if (!task) return json({ error: "Not found" }, 404);
  // A human check, or any job opened with "Finish in Vantage" while the agent is on it (or about to start it).
  const interactive = Boolean((task.user_input as { interactive?: boolean } | null)?.interactive);
  const live = task.status === "needs_human" || (interactive && ["queued", "running", "waiting_code", "needs_user"].includes(task.status)) || task.status === "running";
  if (!live) return json({ error: "Your agent isn't on this application right now." }, 409);
  const base = process.env.WORKER_URL;
  if (!base || !process.env.AGENT_SECRET) return json({ error: "Live view isn't available yet." }, 503);
  const exp = Math.floor(Date.now() / 1000) + 45 * 60;
  const sig = createHmac("sha256", process.env.AGENT_SECRET).update(`${task.id}.${exp}`).digest("hex");
  return json({ url: `${base.replace(/\/$/, "")}/live/${task.id}`, token: `${exp}.${sig}` });
}
