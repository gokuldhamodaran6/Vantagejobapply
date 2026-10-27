import "server-only";
import { planFields, type FormField, type Missing } from "./fields";
import type { Facts } from "./fields";
import type { ResumeContent } from "@/lib/types";

/**
 * Ask before applying: for careers systems that publish their application questions (Greenhouse), read the form
 * before the agent opens it. Questions only the person can answer are asked up front, together, instead of
 * stopping the run half-way. Ordinary questions the AI writes from the resume are not asked.
 */
type GhQuestion = { label: string; required?: boolean; fields?: { name: string; type: string; values?: { label: string; value: string | number }[] }[] };

export async function formQuestions(jobId: string): Promise<FormField[] | null> {
  const m = jobId.match(/^gh:([^:]+):(\d+)$/);
  if (!m) return null;
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(m[1])}/jobs/${m[2]}?questions=true`, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!r?.ok) return null;
  const d = (await r.json().catch(() => null)) as { questions?: GhQuestion[]; location_questions?: GhQuestion[] } | null;
  if (!d?.questions) return null;
  const out: FormField[] = [];
  let i = 0;
  for (const q of [...d.questions, ...(d.location_questions || [])]) {
    const f = q.fields?.[0];
    if (!f || f.type === "input_hidden") continue;
    const type: FormField["type"] = f.type === "input_file" ? "file" : f.type === "textarea" ? "textarea" : f.type === "multi_value_single_select" ? "select" : f.type === "multi_value_multi_select" ? "checkboxes" : "text";
    const options = f.values?.length ? f.values.map((v) => String(v.label)) : undefined;
    out.push({ id: `pre${i++}`, label: q.label, name: f.name, type, required: Boolean(q.required), options });
  }
  return out;
}

export async function questionsBefore(input: {
  jobId: string;
  facts: Facts;
  answers: { qkey: string; question: string; answer: string }[];
  job: { title: string; company: string };
  resume: ResumeContent | null;
  consent: boolean;
}): Promise<Missing[] | null> {
  const fields = await formQuestions(input.jobId);
  if (!fields?.length) return null;
  const { missing } = await planFields(fields, { facts: input.facts, answers: input.answers, job: input.job, resume: input.resume, coverLetter: "x", consent: input.consent, noAi: true });
  // Terms and privacy boxes are confirmed on the page itself (they depend on the site's own wording at the time).
  return missing.filter((x) => x.type !== "file" && x.kind !== "consent");
}
