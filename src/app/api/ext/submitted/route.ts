import { extJson, extRpc, extUser, ownTask } from "@/lib/ext";
import { rpc } from "@/lib/agent/svc";

/**
 * The user submitted on the company's site (the extension saw the confirmation page, or they told us).
 * The job goes into Applications, and replies from the company are tracked from the inbox like any other.
 */
export async function POST(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; answers?: Record<string, string>; how?: "detected" | "manual" };
  // Older extensions mistook sign-in and next-step pages for confirmations; only trust their "detected" after updating.
  const ver = req.headers.get("x-vantage-ext") || "1.0.0";
  if (body.how === "detected" && ver.localeCompare("1.1.2", undefined, { numeric: true }) < 0) return extJson({ ok: false, error: "Update the Vantage extension to record this automatically, or mark it in Your agent." }, 426);
  const t = await ownTask(u.user_id, String(body.taskId || ""));
  if (!t) return extJson({ error: "Not found" }, 404);
  if (t.status === "submitted") return extJson({ ok: true, already: true });
  await rpc("update", { task_id: body.taskId, status: "submitted", step: "Applied", needs: [], log: body.how === "detected" ? "You submitted it — the confirmation page was detected by the Vantage extension" : "You marked it as submitted in the Vantage extension" });
  await rpc("record_application", { task_id: body.taskId, answers: body.answers || {} });
  await extRpc("mark_extension_app", { task_id: body.taskId, user_id: u.user_id });
  return extJson({ ok: true });
}
