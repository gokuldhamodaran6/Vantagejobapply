import { extJson, extRpc, extUser, ownTask } from "@/lib/ext";
import { qkeyOf } from "@/lib/agent/fields";

/** Answers the user typed in the extension panel: saved once, reused on every future application. */
export async function POST(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; answers?: { label: string; type?: string; answer: string }[] };
  if (!(await ownTask(u.user_id, String(body.taskId || "")))) return extJson({ error: "Not found" }, 404);
  const answers = (body.answers || []).filter((a) => a?.label && String(a.answer || "").trim()).slice(0, 50)
    .map((a) => ({ qkey: qkeyOf(a.label), question: a.label.slice(0, 500), answer: String(a.answer).slice(0, 4000), kind: a.type || "text" }));
  const r = await extRpc<{ saved: number }>("save_answers", { user_id: u.user_id, answers });
  return extJson({ ok: true, saved: r.saved });
}
