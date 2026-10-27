import { extJson, extUser, ownTask } from "@/lib/ext";
import { loadBundle } from "@/lib/agent/bundle";
import { planFields, type FormField } from "@/lib/agent/fields";
import { runWithAi } from "@/lib/ai-context";

export const maxDuration = 60;

/** Answers for the fields the extension found: saved answers, your profile, and AI for open questions. */
export async function POST(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; fields?: FormField[] };
  if (!(await ownTask(u.user_id, String(body.taskId || "")))) return extJson({ error: "Not found" }, 404);
  const b = await loadBundle(String(body.taskId));
  if (!b) return extJson({ error: "Not found" }, 404);
  const fields = (body.fields || []).filter((f) => f && f.id && f.type !== "password").slice(0, 80);
  const out = await runWithAi({ userId: u.user_id, taskId: String(body.taskId), feature: "plan-ext" }, () => planFields(fields, {
    facts: b.facts, answers: b.raw.answers, job: { title: b.task.job.title, company: b.task.job.company }, resume: b.resume,
    coverLetter: b.task.cover_letter, consent: Boolean(b.raw.applicant?.agent_consent),
  }));
  return extJson(out);
}
