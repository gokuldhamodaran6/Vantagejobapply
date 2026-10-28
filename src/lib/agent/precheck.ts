import "server-only";
import { planFields, type FormField, type Missing } from "./fields";
import type { Facts } from "./fields";
import type { ResumeContent } from "@/lib/types";

/**
 * Ask before applying: for careers systems that publish their application questions (Greenhouse, Lever, Ashby), read
 * the form before the agent opens it. Questions only the person can answer are asked up front, together, instead of
 * stopping the run half-way. Ordinary questions the AI writes from the resume are not asked.
 */
type GhQuestion = { label: string; required?: boolean; fields?: { name: string; type: string; values?: { label: string; value: string | number }[] }[] };

export async function formQuestions(jobId: string): Promise<FormField[] | null> {
  if (jobId.startsWith("lever:")) return leverQuestions(jobId);
  if (jobId.startsWith("ashby:")) return ashbyQuestions(jobId);
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

const UA = "Mozilla/5.0 (compatible; VantageJobs/1.0; +https://vantagejobapply.onrender.com)";
const decode = (x: string) => x.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Lever: the apply page carries each custom question card as JSON (cards[…][baseTemplate]). Standard fields (name,
 * email, phone, resume, links) and the voluntary survey are filled from the profile, so only the cards matter.
 */
type LeverCardField = { type?: string; text?: string; required?: boolean; options?: { text?: string }[] };
export function parseLeverApply(html: string): FormField[] {
  const out: FormField[] = [];
  let i = 0;
  for (const m of html.matchAll(/name="cards\[[^\]]+\]\[baseTemplate\]"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="cards\[[^\]]+\]\[baseTemplate\]"/g)) {
    let card: { fields?: LeverCardField[] } | null = null;
    try { card = JSON.parse(decode(m[1] ?? m[2] ?? "")); } catch { card = null; }
    for (const f of card?.fields || []) {
      const label = String(f.text || "").trim();
      if (!label) continue;
      const opts = (f.options || []).map((o) => String(o.text || "").trim()).filter(Boolean);
      const t = String(f.type || "text");
      const type: FormField["type"] = t === "file-upload" ? "file" : t === "textarea" ? "textarea" : t === "multiple-select" ? "checkboxes" : t === "multiple-choice" || t === "dropdown" ? "select" : "text";
      out.push({ id: `pre${i++}`, label, type, required: Boolean(f.required), options: opts.length ? opts : undefined });
    }
  }
  return out;
}

async function leverQuestions(jobId: string): Promise<FormField[] | null> {
  const m = jobId.match(/^lever:([^:]+):([0-9a-f-]{20,})$/i);
  if (!m) return null;
  const r = await fetch(`https://jobs.lever.co/${encodeURIComponent(m[1])}/${m[2]}/apply`, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!r?.ok) return null;
  const html = await r.text().catch(() => "");
  if (!/application-form|cards\[/.test(html)) return null;
  return parseLeverApply(html);
}

/** Ashby: the public job page reads its form from Ashby's own GraphQL endpoint — the same request, once. */
type AshbyField = { title?: string; type?: string; isNullable?: boolean; selectableValues?: { label?: string; value?: string }[] };
export function parseAshbyForm(d: unknown): FormField[] {
  const sections = (d as { data?: { jobPosting?: { applicationForm?: { sections?: { fieldEntries?: { field?: AshbyField; isRequired?: boolean }[] }[] } } } })?.data?.jobPosting?.applicationForm?.sections || [];
  const out: FormField[] = [];
  let i = 0;
  for (const sec of sections) for (const e of sec.fieldEntries || []) {
    const f = e.field;
    const label = text(String(f?.title || ""));
    if (!f || !label) continue;
    const t = String(f.type || "String");
    const opts = (f.selectableValues || []).map((v) => String(v.label || v.value || "").trim()).filter(Boolean);
    const type: FormField["type"] = t === "File" ? "file" : t === "LongText" ? "textarea" : t === "MultiValueSelect" ? "checkboxes" : t === "ValueSelect" || t === "Boolean" ? "select" : "text";
    out.push({ id: `pre${i++}`, label, type, required: Boolean(e.isRequired), options: t === "Boolean" ? ["Yes", "No"] : opts.length ? opts : undefined });
  }
  return out;
}

async function ashbyQuestions(jobId: string): Promise<FormField[] | null> {
  const m = jobId.match(/^ashby:([^:]+):([0-9a-f-]{20,})$/i);
  if (!m) return null;
  const query = "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id applicationForm { sections { fieldEntries { ... on FormFieldEntry { isRequired field } } } } } }";
  const r = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: m[1], jobPostingId: m[2] }, query }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const fields = parseAshbyForm(d);
  return fields.length ? fields : null;
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
