import "server-only";
import { claude, extractJson } from "@/lib/ai";
import { aiFacts, aiResume, bestOption, coreLabel, lockedKind, planFields, qkeyOf, type Facts, type Fill, type FormField, type Missing } from "./fields";
import type { ResumeContent } from "@/lib/types";

/**
 * Vantage Pilot — the brain. It looks at one careers-site page the way a person would (every control, its question,
 * section, value, options and errors) and decides what to do next: type, pick, tick, upload, add a work-history entry,
 * press Next. The same brain drives the cloud agent and the Chrome extension.
 *
 * Safety is enforced here, not trusted to the AI:
 * - Contact details never reach the AI: it sees {{placeholders}}, filled in after it answers.
 * - Eligibility answers (visa, right to work, citizenship, record, pay history, clearance, age) and EEO answers come
 *   only from the person's own saved answers/profile; anything else is asked.
 * - Final Submit is never pressed by the pilot; it reports "ready" with the button instead.
 * - Password boxes are never touched (the account step is handled separately with the per-site vault login).
 */

export type PilotItem = {
  i: number; kind: string; label: string; value?: string; options?: string[]; required?: boolean; section?: string; error?: string;
  of?: number; selected?: boolean; more?: boolean; final?: boolean; placeholder?: string; expanded?: boolean; accept?: string; pressed?: boolean;
  max?: number; otp?: boolean; rk?: string;
};
export type PilotSnapshot = {
  url: string; title?: string; headings?: string[]; step?: string; progress?: string; dialog?: string; errors?: string[]; excerpt?: string; items: PilotItem[];
};
export type PilotAction = { do: "fill" | "set" | "choose" | "click" | "upload" | "key" | "wait" | "scroll" | "clear"; i?: number; value?: string; file?: "resume" | "cover_letter"; key?: string; ms?: number };
export type PilotResult = { ok: boolean; note?: string; chosen?: string; options?: string[]; value?: string };
export type PilotHistory = { say?: string; actions: PilotAction[]; results: PilotResult[]; url?: string }[];
export type PilotStatus = "continue" | "next" | "ready" | "account" | "ask" | "done" | "stuck";
export type PilotTurn = { say: string; status: PilotStatus; actions: PilotAction[]; submit?: number; ask: Missing[]; notes?: string[] };

export type PilotCtx = {
  taskId: string;
  facts: Facts;
  answers: { qkey: string; question: string; answer: string }[];
  job: { title: string; company: string; description?: string | null };
  resume: ResumeContent | null;
  coverLetter: string | null;
  consent: boolean;
  /** Answers the person approved in the review step, keyed like PilotItem.rk. Used exactly as approved. */
  approved?: Record<string, string> | null;
  /** The extension: the person presses Submit themselves. */
  surface: "agent" | "extension";
};

const FIELD_KINDS = new Set(["text", "email", "tel", "url", "number", "date", "month", "textarea", "select", "combobox", "radio", "checkbox", "checkboxes", "file"]);
const EEO = /\bgender\b|\bsex\b|\brace\b|ethnic|hispanic|latin[oax]|veteran|disabilit|pronoun|sexual orientation|transgender|lgbt/i;
const REPEATED = /(work )?experience|employment|work history|job \d|position \d|education|school|degree \d|language \d|certification \d/i;

/* ---------------- contact details: placeholders in, real values out ---------------- */
const PH: [string, keyof Facts | ((f: Facts) => string)][] = [
  ["first_name", "first_name"], ["last_name", "last_name"], ["full_name", "full_name"], ["preferred_name", "preferred_name"],
  ["email", "email"], ["phone", "phone"], ["phone_digits", (f) => f.phone.replace(/\D/g, "")],
  ["phone_national", (f) => national(f.phone)], ["address_line1", "address1"], ["postal_code", "postal"],
  ["linkedin", "linkedin"], ["github", "github"], ["website", "website"],
];
function national(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length > 10 && phone.trim().startsWith("+")) return d.slice(-10);
  return d;
}
function factValue(f: Facts, k: string) {
  const e = PH.find(([n]) => n === k);
  if (!e) return null;
  return typeof e[1] === "function" ? e[1](f) : (f[e[1]] as string) || "";
}
/** Real values → {{placeholders}} in anything shown to the AI. Longest values first, so "Gokul D" beats "Gokul". */
function masker(f: Facts) {
  const pairs = PH.map(([n]) => [factValue(f, n) || "", `{{${n}}}`] as [string, string]).filter(([v]) => v && v.length >= 3);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const res = pairs.map(([v, p]) => [new RegExp(esc(v), "gi"), p] as [RegExp, string]);
  const phoneRe = f.phone.replace(/\D/g, "").length >= 7 ? new RegExp(f.phone.replace(/\D/g, "").slice(-7).split("").join("[^0-9]{0,3}"), "g") : null;
  return (s: string | undefined | null) => {
    if (!s) return s || "";
    let out = String(s);
    for (const [re, p] of res) out = out.replace(re, p);
    if (phoneRe) out = out.replace(phoneRe, "{{phone}}");
    return out;
  };
}
function unmask(f: Facts, s: string) {
  return s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => {
    const v = factValue(f, k);
    return v === null ? m : v;
  });
}

/* ---------------- deterministic suggestions from the existing planner ---------------- */
type Suggestion = { value?: string; file?: "resume" | "cover_letter"; check?: boolean; ask?: Missing; approved?: boolean };
const cache = new Map<string, { at: number; s: Suggestion | null }>();
const CACHE_MS = 30 * 60 * 1000;

function asField(it: PilotItem): FormField | null {
  if (!FIELD_KINDS.has(it.kind)) return null;
  const type = (it.kind === "month" ? "text" : it.kind) as FormField["type"];
  return { id: String(it.i), label: it.label || "", type, required: it.required, options: it.options, placeholder: it.placeholder, section: it.section };
}

async function suggestions(snap: PilotSnapshot, ctx: PilotCtx): Promise<Map<number, Suggestion>> {
  const out = new Map<number, Suggestion>();
  const todo: { it: PilotItem; f: FormField; key: string }[] = [];
  // New saved answers (the person just answered a question) must take effect at once: they're part of the key.
  let h = 0;
  for (const ch of ctx.answers.map((a) => `${a.qkey}=${a.answer}`).join("|")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const bankSig = `${ctx.answers.length}:${h}`;
  for (const it of snap.items) {
    if (it.rk && ctx.approved && typeof ctx.approved[it.rk] === "string") {
      out.set(it.i, it.kind === "checkbox" ? { check: ctx.approved[it.rk] === "Checked", approved: true } : { value: ctx.approved[it.rk], approved: true });
      continue;
    }
    const f = asField(it);
    if (!f || !f.label) continue;
    // Repeated sections (work history, schools) are filled from the resume by the pilot, entry by entry.
    if (REPEATED.test(it.section || "") && !/resume|cv|cover/i.test(it.label) && it.kind !== "file") continue;
    const filled = it.kind === "file" ? Boolean(it.value) : it.kind === "checkbox" ? it.value === "checked" : Boolean(it.value);
    const lk = lockedKind(`${it.label}`) || (EEO.test(it.label) ? "eeo" : null);
    if (filled && !lk && !it.error) continue;
    const key = `${ctx.taskId}|${bankSig}|${it.kind}|${qkeyOf(it.label)}|${(it.options || []).slice(0, 30).join("¦")}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      if (hit.s) out.set(it.i, hit.s);
      continue;
    }
    todo.push({ it, f, key });
  }
  if (!todo.length) return out;
  const plan = await planFields(todo.map((t) => t.f).slice(0, 80), {
    facts: ctx.facts, answers: ctx.answers, job: ctx.job, resume: ctx.resume, coverLetter: ctx.coverLetter, consent: ctx.consent,
  }).catch((e) => { console.error("pilot plan failed", e); return { fills: [] as Fill[], missing: [] as Missing[] }; });
  for (const t of todo) {
    const fill = plan.fills.find((x) => x.id === String(t.it.i));
    const miss = plan.missing.find((x) => x.id === String(t.it.i));
    const s: Suggestion | null = fill ? { value: fill.value, file: fill.file, check: fill.check } : miss ? { ask: miss } : null;
    cache.set(t.key, { at: Date.now(), s });
    if (s) out.set(t.it.i, s);
  }
  if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return out;
}

/* ---------------- what the AI sees ---------------- */
function line(it: PilotItem, s: Suggestion | undefined, mask: (x: string) => string) {
  const parts = [`[${it.i}] ${it.kind}`];
  if (it.label) parts.push(JSON.stringify(mask(it.label).slice(0, 160)));
  if (it.kind === "option") {
    if (it.of !== undefined) parts.push(`(in [${it.of}])`);
    if (it.more) parts.push("› has sub-options");
    if (it.selected) parts.push("✓selected");
    return parts.join(" ");
  }
  if (it.value !== undefined && it.kind !== "button" && it.kind !== "link") parts.push(`= ${JSON.stringify(mask(it.value).slice(0, 120))}`);
  if (it.options?.length) parts.push(`options: ${it.options.slice(0, 25).map((o) => mask(o).slice(0, 60)).join(" | ")}${it.options.length > 25 ? ` | …(${it.options.length - 25} more)` : ""}`);
  if (it.required) parts.push("REQUIRED");
  if (it.expanded) parts.push("(open)");
  if (it.final) parts.push("FINAL-SUBMIT");
  if (it.pressed) parts.push("(selected)");
  if (it.placeholder && !it.value) parts.push(`placeholder ${JSON.stringify(it.placeholder.slice(0, 40))}`);
  if (it.max) parts.push(`max ${it.max} chars`);
  if (it.section) parts.push(`§ ${mask(it.section).slice(0, 60)}`);
  if (it.error) parts.push(`⚠ ${JSON.stringify(mask(it.error).slice(0, 120))}`);
  if (s) {
    if (s.ask) parts.push(s.ask.locked ? "→ LOCKED: only the applicant answers this (ask)" : "→ ASK the applicant (no saved answer)");
    else if (s.file) parts.push(`→ upload ${s.file}`);
    else if (s.check !== undefined) parts.push(`→ ${s.check ? "tick" : "leave unticked"}${s.approved ? " (APPROVED)" : ""}`);
    else if (s.value) parts.push(`→ use ${JSON.stringify(mask(s.value).slice(0, 300))}${s.approved ? " (APPROVED — exactly)" : ""}`);
  }
  return parts.join(" ");
}

const SYSTEM = `You are Vantage Pilot. You complete a job application in a real web browser for an applicant, like a careful human assistant sitting at their computer. Each turn you see the current page as a numbered list of controls and decide the next actions. Work fast but never guess facts.

ACTIONS (JSON):
- {"do":"fill","i":N,"value":"text"} type into a text box / textarea (replaces what's there).
- {"do":"choose","i":N,"value":"Option"} pick from a dropdown, combobox, type-ahead or searchable list. For nested lists give the path: "Job Board > LinkedIn". Use it on the control, not on its options.
- {"do":"set","i":N,"value":"Yes"} radio group / native select / checkbox ("checked" or "unchecked") / checkbox group ("A; B").
- {"do":"click","i":N} buttons, links, "Add" buttons, list options shown on the page, Next / Continue / Save and Continue.
- {"do":"upload","i":N,"file":"resume"|"cover_letter"} attach the applicant's file to an upload control (the file input or its "Select file"/"Upload" button).
- {"do":"key","key":"Enter"|"Escape"|"Tab"}, {"do":"wait","ms":1500}, {"do":"scroll","value":"down"}.

STATUS (JSON "status"):
- "continue": you acted on this page and need to see it again (default after filling).
- "next": your LAST action clicks the button that goes to the next step (only when every required field on the page is filled and there are no errors).
- "ready": every step is complete and the only thing left is the final submit button; put its number in "submit". Never click a FINAL-SUBMIT button yourself.
- "account": the page wants a password (sign in / create account / verify password). Do not touch password boxes.
- "ask": a required answer only the applicant knows is missing; list it in "ask" (after filling everything else you can).
- "done": the page confirms the application was submitted.
- "stuck": you cannot make progress; explain in "say".

VALUES:
- Contact details are placeholders you write literally: {{first_name}} {{last_name}} {{full_name}} {{preferred_name}} {{email}} {{phone}} {{phone_national}} {{phone_digits}} {{address_line1}} {{postal_code}} {{linkedin}} {{github}} {{website}}. Use {{phone_national}} when the page has a separate country-code control. Never write real contact details yourself.
- A control marked "→ use X" has the applicant's own answer: use exactly X (pick the option that means X). "(APPROVED — exactly)" must not change at all.
- "→ LOCKED" or "→ ASK": never answer it yourself; put it in "ask" with the question and options. Eligibility (visa, sponsorship, right to work, citizenship), criminal record, pay history, clearance, age, and gender/race/ethnicity/veteran/disability are ONLY ever answered from "→ use".
- Work history and education sections: fill them from RESUME, entry by entry, most recent first. Click "Add"/"Add Another" to create the entries you need (all jobs up to 6, all schools up to 3). Job title, company, location, from/to dates (month + year; for spin-buttons type digits like "03" and "2024"), "I currently work here" for a current job, and a short role description from that job's bullets. Never invent employers, dates, degrees or numbers.
- Skills lists: add up to 10 relevant skills from the resume (type one, pick it, repeat).
- "How did you hear about us": use the "→ use" answer if given; otherwise the company's careers site / website, else "Other". Never claim a referral or an employee you don't know.
- "Have you worked here before" / previous worker: "No" unless the resume shows this company.
- Phone device type: Mobile. Country / phone country code: the applicant's country.
- Open questions (why this company, describe experience): 2–4 specific, truthful first-person sentences from RESUME and the job. No clichés, never mention AI.
- Optional fields you have no answer for: leave them. Respect "max N chars".

HOW TO WORK:
- Fill everything you can on the page in ONE turn (many actions), then status "continue" to verify. When the page looks complete and error-free, click the page's Next/Continue/Save and Continue button with status "next".
- After each turn you get the results. If "choose" fails, look at the options it reports or click the control and pick from the listed options next turn. Fix every ⚠ error and every page error.
- Start pages: "Apply" / "Apply Now" opens the application. On Workday's "Start Your Application" prefer "Apply Manually" (or "Autofill with Resume", then upload the resume). On sign-in choice pages click "Sign in with email" or "Create Account" — never Google/LinkedIn/Indeed sign-in, never "Apply with LinkedIn".
- Upload the resume wherever a resume/CV upload is offered (also on autofill pages). Upload the cover letter only to a cover-letter control.
- Never press a FINAL-SUBMIT button; status "ready" instead. On a review page, check it and report "ready".
- Don't repeat an action that failed twice the same way; try another way or report "stuck".

Reply with ONLY JSON: {"say":"<6-12 words for the applicant: what you're doing>","actions":[...],"status":"...","submit":N?,"ask":[{"i":N,"question":"...","options":[...]}]?}`;

export async function pilotStep(snap: PilotSnapshot, history: PilotHistory, ctx: PilotCtx): Promise<PilotTurn> {
  const mask = masker(ctx.facts);
  const sugg = await suggestions(snap, ctx);
  const items = snap.items.slice(0, 260);
  const page = [
    `URL: ${mask(snap.url).slice(0, 200)}`,
    snap.title ? `TITLE: ${mask(snap.title)}` : "",
    snap.headings?.length ? `HEADINGS: ${snap.headings.map(mask).join(" | ")}` : "",
    snap.step || snap.progress ? `STEP: ${mask(snap.step || "")} ${snap.progress ? `(${mask(snap.progress)})` : ""}` : "",
    snap.dialog ? `DIALOG OPEN: ${mask(snap.dialog)}` : "",
    snap.errors?.length ? `PAGE ERRORS: ${snap.errors.map(mask).join(" || ")}` : "",
    `TEXT: ${mask(snap.excerpt || "").slice(0, 700)}`,
    "CONTROLS:",
    ...items.map((it) => line(it, sugg.get(it.i), mask)),
  ].filter(Boolean).join("\n");

  const hist = history.slice(-4).map((h, k) => `#${k + 1} ${h.say ? `(${mask(h.say)}) ` : ""}${h.url && h.url !== snap.url ? `[on ${mask(h.url).slice(0, 80)}] ` : ""}` +
    h.actions.map((a, j) => {
      const r = h.results[j];
      const what = `${a.do}${a.i !== undefined ? ` [${a.i}]` : ""}${a.value !== undefined ? ` ${JSON.stringify(mask(a.value).slice(0, 60))}` : ""}${a.file ? ` ${a.file}` : ""}${a.key ? ` ${a.key}` : ""}`;
      const res = !r ? "not run" : r.ok ? `ok${r.chosen ? ` → ${JSON.stringify(mask(r.chosen).slice(0, 60))}` : ""}` : `FAILED${r.note ? `: ${mask(r.note).slice(0, 100)}` : ""}${r.options?.length ? ` options: ${r.options.slice(0, 20).map(mask).join(" | ")}` : ""}`;
      return `${what} → ${res}`;
    }).join("; ")).join("\n");

  const resume = aiResume(ctx.resume);
  const facts = aiFacts(ctx.facts);
  const known = PH.map(([n]) => n).filter((n) => factValue(ctx.facts, n)).map((n) => `{{${n}}}`).join(" ");
  const user = [
    `JOB: ${ctx.job.title} at ${ctx.job.company}`,
    `APPLICANT (non-contact facts): ${JSON.stringify(facts)}`,
    `CONTACT PLACEHOLDERS AVAILABLE: ${known || "none"}`,
    `RESUME: ${JSON.stringify(resume).slice(0, 9000)}`,
    ctx.coverLetter ? "A tailored cover letter file is available (upload \"cover_letter\")." : "No cover letter file.",
    ctx.surface === "extension" ? "MODE: the applicant is watching in their own browser and presses Submit themselves." : "MODE: cloud agent.",
    hist ? `PREVIOUS TURNS (newest last):\n${hist}` : "",
    `PAGE NOW:\n${page}`,
  ].filter(Boolean).join("\n\n");

  const raw = await claude(SYSTEM, [{ role: "user", content: user }], 3000, { model: "pilot", temperature: 0 });
  const parsed = extractJson<{ say?: string; actions?: PilotAction[]; status?: string; submit?: number; ask?: { i?: number; question?: string; options?: string[] }[] }>(raw);
  if (!parsed) return { say: "Couldn't read the page this time", status: "stuck", actions: [], ask: [], notes: ["no AI answer"] };
  return validate(parsed, snap, sugg, ctx);
}

/** Enforce the rules on whatever the AI proposed, and put real contact details in. */
function validate(p: { say?: string; actions?: PilotAction[]; status?: string; submit?: number; ask?: { i?: number; question?: string; options?: string[] }[] }, snap: PilotSnapshot, sugg: Map<number, Suggestion>, ctx: PilotCtx): PilotTurn {
  const byI = new Map(snap.items.map((it) => [it.i, it]));
  const notes: string[] = [];
  const ask = new Map<string, Missing>();
  const addAsk = (it: PilotItem | undefined, q?: string, opts?: string[]) => {
    if (!it && !q) return;
    const label = coreLabel(q || it?.label || "");
    if (!label) return;
    const s = it ? sugg.get(it.i) : undefined;
    const lk = lockedKind(label);
    const m: Missing = s?.ask || { id: it ? String(it.i) : qkeyOf(label), qkey: qkeyOf(it?.label || label), label, type: (asField(it || ({ kind: "text" } as PilotItem))?.type || "text"), options: opts?.length ? opts : it?.options, required: true, ...(lk ? { locked: lk } : {}) };
    ask.set(m.qkey, m);
  };
  // The control a list option belongs to.
  const owner = (it: PilotItem | undefined) => (it?.kind === "option" && it.of !== undefined ? byI.get(it.of) : it);
  const guarded = (it: PilotItem | undefined) => {
    const o = owner(it);
    if (!o) return null;
    if (o.kind === "password") return "password";
    if (lockedKind(o.label || "")) return "locked";
    if (EEO.test(o.label || "")) return "eeo";
    if (o.rk && ctx.approved && typeof ctx.approved[o.rk] === "string") return "approved";
    return null;
  };

  const actions: PilotAction[] = [];
  let status = (["continue", "next", "ready", "account", "ask", "done", "stuck"].includes(String(p.status)) ? p.status : "continue") as PilotStatus;
  let submit: number | undefined;
  for (const a of (p.actions || []).slice(0, 40)) {
    if (!a || typeof a !== "object" || !a.do) continue;
    if (["key", "wait", "scroll"].includes(a.do)) { actions.push({ do: a.do, key: a.key, ms: a.ms, value: a.value }); continue; }
    const it = byI.get(Number(a.i));
    if (!it) { notes.push(`dropped ${a.do} on missing [${a.i}]`); continue; }
    if (a.do === "click" && (it.final || owner(it)?.final)) { submit = it.i; status = "ready"; notes.push("final submit is not pressed by the pilot"); continue; }
    if (it.kind === "password") { status = "account"; notes.push("password boxes are handled by the account step"); continue; }
    if (a.do === "upload") {
      const file = a.file === "cover_letter" ? (ctx.coverLetter ? "cover_letter" : null) : "resume";
      if (!file) continue;
      actions.push({ do: "upload", i: it.i, file });
      continue;
    }
    const g = guarded(it);
    const target = owner(it)!;
    const s = sugg.get(target.i);
    if (g === "locked" || g === "eeo" || g === "approved") {
      // Only the person's own answer may go in. Clicking an option counts as answering.
      const proposed = a.do === "click" && it.kind === "option" ? it.label : a.do === "click" ? null : String(a.value ?? "");
      if (a.do === "click" && it.kind !== "option") { actions.push({ do: "click", i: it.i }); continue; } // opening the list is fine
      const allowed = s?.value ?? (s?.check !== undefined ? (s.check ? "checked" : "unchecked") : null);
      if (!allowed) {
        if (g === "locked" || target.required) addAsk(target);
        notes.push(`${g} answer withheld for "${coreLabel(target.label).slice(0, 60)}"`);
        continue;
      }
      const opts = target.options?.length ? target.options : snap.items.filter((x) => x.kind === "option" && x.of === target.i).map((x) => x.label);
      const same = proposed !== null && (proposed.trim().toLowerCase() === allowed.trim().toLowerCase() || (opts.length > 0 && bestOption(opts, allowed) === proposed));
      if (it.kind === "option") {
        if (same) actions.push({ do: "click", i: it.i });
        else notes.push(`option "${it.label.slice(0, 40)}" isn't the applicant's answer`);
        continue;
      }
      actions.push({ do: a.do === "fill" && target.kind !== "text" && target.kind !== "textarea" ? "set" : a.do, i: target.i, value: allowed });
      if (!same) notes.push(`used the applicant's own answer for "${coreLabel(target.label).slice(0, 60)}"`);
      continue;
    }
    const value = a.value === undefined || a.value === null ? undefined : unmask(ctx.facts, String(a.value)).slice(0, target.max || 6000);
    if (value !== undefined && /\{\{[a-z_]+\}\}/.test(value)) { notes.push(`no value for ${value.match(/\{\{[a-z_]+\}\}/)![0]}`); continue; }
    actions.push({ do: a.do, i: it.i, ...(value !== undefined ? { value } : {}) });
  }

  for (const q of p.ask || []) {
    const it = q.i !== undefined ? byI.get(Number(q.i)) : undefined;
    addAsk(it, it ? undefined : q.question, q.options);
  }
  if (status === "ask" && !ask.size) status = "continue";
  if (ask.size && status !== "ready") status = "ask";
  if (status === "ready" && submit === undefined) {
    const s = Number(p.submit);
    const it = byI.get(s);
    if (it && (it.final || /submit|apply|send|finish|complete/i.test(it.label))) submit = it.i;
    else {
      const f = snap.items.find((x) => x.final);
      if (f) submit = f.i;
      else { status = "continue"; notes.push("no submit button found yet"); }
    }
  }
  if (status === "next" && !actions.some((a) => a.do === "click")) status = "continue";
  return { say: String(p.say || "Working on the application").slice(0, 120), status, actions, ...(submit !== undefined ? { submit } : {}), ask: [...ask.values()], notes };
}

type Bundle = NonNullable<Awaited<ReturnType<typeof import("./bundle").loadBundle>>>;

/** Everything the pilot may know about this application, from the task's bundle. */
export function pilotCtx(b: Bundle, surface: PilotCtx["surface"], approved?: Record<string, string> | null): PilotCtx {
  return {
    taskId: b.task.id,
    facts: b.facts,
    answers: b.raw.answers,
    job: { title: b.task.job.title, company: b.task.job.company },
    resume: b.resume,
    coverLetter: b.task.cover_letter || null,
    consent: Boolean(b.raw.applicant?.agent_consent),
    approved: approved || null,
    surface,
  };
}

/** Keep only what a snapshot should carry (the page is untrusted input). */
export function cleanSnapshot(s: unknown): PilotSnapshot | null {
  const x = s as PilotSnapshot | null;
  if (!x || typeof x !== "object" || !Array.isArray(x.items)) return null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  return {
    url: str(x.url, 600) || "",
    title: str(x.title, 200),
    headings: Array.isArray(x.headings) ? x.headings.slice(0, 8).map((h) => String(h).slice(0, 160)) : [],
    step: str(x.step, 120),
    progress: str(x.progress, 240),
    dialog: str(x.dialog, 400),
    errors: Array.isArray(x.errors) ? x.errors.slice(0, 10).map((e) => String(e).slice(0, 300)) : [],
    excerpt: str(x.excerpt, 1200),
    items: x.items.slice(0, 300).filter((it) => it && typeof it === "object" && Number.isInteger(it.i)).map((it) => ({
      i: it.i, kind: String(it.kind || "").slice(0, 20), label: String(it.label || "").slice(0, 300),
      value: it.value === undefined ? undefined : String(it.value).slice(0, 400),
      options: Array.isArray(it.options) ? it.options.slice(0, 300).map((o) => String(o).slice(0, 140)) : undefined,
      required: Boolean(it.required) || undefined, section: str(it.section, 100), error: str(it.error, 200),
      of: Number.isInteger(it.of) ? it.of : undefined, selected: Boolean(it.selected) || undefined, more: Boolean(it.more) || undefined,
      final: Boolean(it.final) || undefined, placeholder: str(it.placeholder, 80), expanded: Boolean(it.expanded) || undefined,
      accept: str(it.accept, 80), pressed: Boolean(it.pressed) || undefined, max: Number.isInteger(it.max) ? it.max : undefined,
      otp: Boolean(it.otp) || undefined, rk: str(it.rk, 400),
    })),
  };
}
