import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { workAuthAnswers } from "@/lib/answers";
import type { ResumeContent, WorkAuth } from "@/lib/types";

/** A form control the worker found on an employer's application page. */
export type FormField = {
  id: string; // worker-assigned handle
  label: string;
  type: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "combobox" | "radio" | "checkbox" | "file" | "password" | "buttons";
  name?: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  section?: string;
};

export type Fill = { id: string; value?: string; file?: "resume" | "cover_letter"; check?: boolean };
export type Missing = { id: string; qkey: string; label: string; type: FormField["type"]; options?: string[]; required: boolean };

export type Facts = {
  first_name: string; last_name: string; full_name: string; preferred_name: string;
  email: string; phone: string; linkedin: string; github: string; website: string;
  address1: string; city: string; state: string; postal: string; country: string; location: string;
  current_company: string; current_title: string; school: string; degree: string; major: string; grad_year: string;
  years_experience: string; salary: string; start: string; notice: string; relocate: string; heard_from: string;
  gender: string; race: string; hispanic: string; veteran: string; disability: string; pronouns: string;
  work_authorized: string; sponsorship: string; sponsorship_detail: string; work_status: string;
};

export function qkeyOf(label: string) {
  return label.toLowerCase().replace(/\*|\(required\)|\(optional\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

const DECLINE = "Decline to self-identify";

/** Facts the agent may use, from the user's profile, application profile, resume and work authorisation. */
export function buildFacts(input: {
  email: string;
  name: string;
  applicant: Record<string, string | boolean | null> | null;
  resume: ResumeContent | null;
  auth: WorkAuth | undefined;
  country: string;
}): Facts {
  const a = input.applicant || {};
  const r = input.resume || ({ name: input.name } as ResumeContent);
  const [first, ...rest] = (input.name || r.name || "").trim().split(/\s+/);
  const latest = r.experience?.[0];
  const edu = r.education?.[0];
  const years = (() => {
    const ys = (r.experience || []).flatMap((e) => [e.start, e.end]).map((d) => (d && /present/i.test(d) ? new Date().getFullYear() : parseInt((d || "").match(/\d{4}/)?.[0] || "", 10))).filter((n) => !isNaN(n));
    return ys.length ? String(Math.max(0, Math.max(...ys) - Math.min(...ys))) : "";
  })();
  const auth = Object.fromEntries(workAuthAnswers(input.country, input.auth).map((x) => [x.key, x.a]));
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "") || "";
  const city = s("city");
  const state = s("state");
  return {
    first_name: s("first_name") || first || "",
    last_name: s("last_name") || rest.join(" "),
    full_name: [s("first_name") || first, s("last_name") || rest.join(" ")].filter(Boolean).join(" "),
    preferred_name: s("preferred_name") || s("first_name") || first || "",
    email: input.email,
    phone: s("phone") || r.phone || "",
    linkedin: s("linkedin") || (r.links || []).find((l) => /linkedin/i.test(l)) || "",
    github: s("github") || (r.links || []).find((l) => /github/i.test(l)) || "",
    website: s("website") || s("portfolio") || (r.links || []).find((l) => !/linkedin|github/i.test(l)) || "",
    address1: s("address_line1"),
    city,
    state,
    postal: s("postal_code"),
    country: s("country") || "",
    location: [city, state].filter(Boolean).join(", ") || r.location || "",
    current_company: latest && /present/i.test(latest.end || "") ? latest.company : latest?.company || "",
    current_title: latest?.title || "",
    school: edu?.school || "",
    degree: edu?.degree || "",
    major: edu?.degree?.split(/,| in /i).slice(1).join(" ").trim() || "",
    grad_year: edu?.end?.match(/\d{4}/)?.[0] || "",
    years_experience: years,
    salary: s("salary_expectation"),
    start: s("earliest_start") || "Immediately",
    notice: s("notice_period") || "Available immediately",
    relocate: a.relocate === true ? "Yes" : a.relocate === false ? "No" : "",
    heard_from: s("heard_from") || "Company website",
    gender: s("gender") || DECLINE,
    race: s("race") || DECLINE,
    hispanic: s("hispanic") || DECLINE,
    veteran: s("veteran") || "I don't wish to answer",
    disability: s("disability") || "I don't wish to answer",
    pronouns: s("pronouns"),
    work_authorized: auth.work_authorized || "",
    sponsorship: auth.sponsorship || "",
    sponsorship_detail: auth.sponsorship_detail || "",
    work_status: auth.work_status || "",
  };
}

type Rule = [RegExp, keyof Facts | "resume" | "cover_letter" | "consent" | "sms" | "full_or_first"];
const RULES: Rule[] = [
  [/\b(resume|cv|curriculum vitae)\b/, "resume"],
  [/\bcover ?letter\b/, "cover_letter"],
  [/\bpreferred (first )?name|nick ?name/, "preferred_name"],
  [/\b(legal )?first name|given name|^first$|fname/, "first_name"],
  [/\b(legal )?last name|surname|family name|^last$|lname/, "last_name"],
  [/^(your |legal |full )?name\b|full name|^name$/, "full_name"],
  [/e-?mail/, "email"],
  [/phone|mobile|cell|telephone/, "phone"],
  [/linkedin/, "linkedin"],
  [/github/, "github"],
  [/portfolio|personal (web)?site|website|blog|other url|^url$/, "website"],
  [/address line ?1|street address|^address$|address 1/, "address1"],
  [/\bcity\b|town/, "city"],
  [/\bstate\b|province|region|county/, "state"],
  [/zip|postal|post ?code/, "postal"],
  [/\bcountry\b(?! code)/, "country"],
  [/(current )?location|where (are you|do you) (currently )?(based|live|located)/, "location"],
  [/authori[sz]ed to work|legally (eligible|authori[sz]ed|permitted|able) to work|right to work|eligible to work|work authori[sz]ation/, "work_authorized"],
  [/(require|need).{0,40}sponsor|sponsorship/, "sponsorship"],
  [/visa status|immigration status|current (work )?status/, "work_status"],
  [/salary|compensation|pay (expectation|requirement)|desired pay/, "salary"],
  [/notice period/, "notice"],
  [/start date|when can you start|available to start|earliest (start|availability)/, "start"],
  [/relocat/, "relocate"],
  [/how did you (hear|find|learn)|where did you (hear|find|learn)|referral source|^source$|job source/, "heard_from"],
  [/pronoun/, "pronouns"],
  [/hispanic|latino|latinx/, "hispanic"],
  [/\brace\b|ethnic/, "race"],
  [/gender|\bsex\b/, "gender"],
  [/veteran|military/, "veteran"],
  [/disabilit/, "disability"],
  [/current (company|employer)|most recent (company|employer)|^company$|employer name/, "current_company"],
  [/current (job )?title|most recent (job )?title|current (role|position)|^title$/, "current_title"],
  [/school|university|college|institution/, "school"],
  [/degree/, "degree"],
  [/major|discipline|field of study|area of study/, "major"],
  [/graduation (date|year)|year of graduation/, "grad_year"],
  [/total years of (professional |relevant |work )?experience|how many years of (professional |work )?experience do you have\??$/, "years_experience"],
  [/text message|sms|whatsapp/, "sms"],
  [/privacy|consent|i agree|acknowledge|terms|certify|attest|accurate and complete|true and correct|data (processing|retention)/, "consent"],
];

/** Pick the option that best matches a desired value (handles Yes/No, decline-to-answer wording, countries, US states). */
export function bestOption(options: string[], want: string): string | null {
  if (!options?.length || !want) return null;
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const w = n(want);
  const opts = options.filter((o) => o && !/^(select|choose|please select|--)/i.test(o.trim()));
  const exact = opts.find((o) => n(o) === w);
  if (exact) return exact;
  const yes = /^(yes|y|true)\b/.test(w);
  const no = /^(no|n|false)\b/.test(w);
  if (yes) return opts.find((o) => /^yes\b/i.test(o.trim())) || null;
  if (no) return opts.find((o) => /^no\b/i.test(o.trim())) || null;
  if (/decline|don.?t wish|prefer not|not to (say|answer|disclose)/.test(w)) {
    return opts.find((o) => /decline|don.?t wish|prefer not|not to (say|answer|disclose|self)|choose not/i.test(o)) || null;
  }
  const starts = opts.find((o) => n(o).startsWith(w) || w.startsWith(n(o)));
  if (starts) return starts;
  const contains = opts.find((o) => n(o).includes(w) || (w.length > 3 && w.includes(n(o)) && n(o).length > 3));
  if (contains) return contains;
  const US: Record<string, string> = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", MA: "massachusetts", MD: "maryland", MI: "michigan", MN: "minnesota", MO: "missouri", NC: "north carolina", NJ: "new jersey", NY: "new york", OH: "ohio", OR: "oregon", PA: "pennsylvania", TX: "texas", VA: "virginia", WA: "washington", WI: "wisconsin" };
  const full = US[want.toUpperCase()];
  if (full) return opts.find((o) => n(o) === full) || null;
  const COUNTRY: Record<string, string[]> = { us: ["united states", "usa", "united states of america"], gb: ["united kingdom", "uk", "great britain"], ca: ["canada"], au: ["australia"], in: ["india"] };
  const alts = COUNTRY[w] || Object.values(COUNTRY).find((v) => v.includes(w));
  if (alts) return opts.find((o) => alts.includes(n(o))) || null;
  return null;
}

const SENSITIVE = /criminal|convict|felony|arrest|background check|drug|reference|ssn|social security|date of birth|birth ?date|\bage\b|passport|national insurance|driver.?s licen[cs]e number|bank|tax id/;

/**
 * Decide a value for every field: deterministic facts first, then saved answers, then (optionally) AI
 * for open-ended questions. Anything personal that isn't known is returned as Missing — asked once, then remembered.
 */
export async function planFields(
  fields: FormField[],
  ctx: { facts: Facts; answers: { qkey: string; question: string; answer: string }[]; job: { title: string; company: string; description?: string | null }; resume: ResumeContent | null; coverLetter: string | null; consent: boolean },
): Promise<{ fills: Fill[]; missing: Missing[] }> {
  const fills: Fill[] = [];
  const open: FormField[] = [];
  const bank = new Map(ctx.answers.map((a) => [a.qkey, a.answer]));
  const bankKeys = ctx.answers.map((a) => ({ k: a.qkey, set: new Set(a.qkey.split(" ")) }));

  const fromBank = (label: string) => {
    const k = qkeyOf(label);
    if (bank.has(k)) return bank.get(k)!;
    const toks = new Set(k.split(" "));
    let best: { k: string; s: number } | null = null;
    for (const b of bankKeys) {
      const inter = [...toks].filter((t) => b.set.has(t)).length;
      const s = inter / Math.max(toks.size, b.set.size);
      if (s >= 0.82 && (!best || s > best.s)) best = { k: b.k, s };
    }
    return best ? bank.get(best.k)! : null;
  };

  for (const f of fields) {
    const label = `${f.label} ${f.name || ""} ${f.placeholder || ""}`.toLowerCase().replace(/[*_]/g, " ").trim();
    if (f.type === "password") continue; // credentials are handled by the worker, never by this planner or the AI
    const saved = fromBank(f.label);
    const rule = RULES.find(([re]) => re.test(label));
    let value: string | null = null;

    if (f.type === "file") {
      if (rule?.[1] === "cover_letter") {
        if (ctx.coverLetter) fills.push({ id: f.id, file: "cover_letter" });
      } else if (!rule || rule[1] === "resume") fills.push({ id: f.id, file: "resume" });
      continue;
    }
    if (rule?.[1] === "cover_letter" && f.type === "textarea") {
      if (ctx.coverLetter) fills.push({ id: f.id, value: ctx.coverLetter });
      continue;
    }
    const formerly = /(previously|ever|formerly|currently) (been )?(employed|worked|work) (by|for|at)|former employee|worked (here|for us) before/.test(label);
    const based = label.match(/(?:currently |presently )?(?:based|located|living|reside|residing) in (?:the )?([a-z .]+?)\??$/);
    if (saved) value = saved;
    else if (formerly && ctx.resume) {
      const co = ctx.job.company.toLowerCase().replace(/[^a-z0-9]/g, "");
      const worked = (ctx.resume.experience || []).some((e) => co && e.company.toLowerCase().replace(/[^a-z0-9]/g, "").includes(co));
      value = worked ? "Yes" : "No";
    } else if (based && ctx.facts.country) {
      const asked = based[1].trim();
      const mine = `${ctx.facts.country} ${ctx.facts.location}`.toLowerCase();
      const aliases: Record<string, string[]> = { "united states": ["united states", "usa", "us"], "united kingdom": ["united kingdom", "uk", "england", "scotland", "wales"], canada: ["canada"], australia: ["australia"] };
      const keys = aliases[asked] || [asked];
      value = keys.some((k) => mine.includes(k)) ? "Yes" : "No";
    } else if (rule) {
      const key = rule[1];
      if (key === "consent") {
        if (ctx.consent && f.type === "checkbox") {
          fills.push({ id: f.id, check: true });
          continue;
        }
        if (ctx.consent && f.options?.length) value = f.options.find((o) => /agree|accept|yes|acknowledge|confirm/i.test(o)) || null;
      } else if (key === "sms") {
        if (f.type === "checkbox") continue; // never opt in to marketing texts
        value = "No";
      } else if (key !== "resume" && key !== "cover_letter" && key !== "full_or_first") {
        value = ctx.facts[key] || null;
        if (key === "sponsorship" && f.options?.length && value) value = /^yes/i.test(value) ? "Yes" : "No";
        if (key === "work_authorized" && f.options?.length && value) value = /^yes/i.test(value) ? "Yes" : "No";
      }
    }

    if (value) {
      if (f.options?.length) {
        const opt = bestOption(f.options, value);
        if (opt) fills.push({ id: f.id, value: opt });
        else open.push(f);
      } else if (f.type === "checkbox") {
        if (/^yes|true/i.test(value)) fills.push({ id: f.id, check: true });
      } else fills.push({ id: f.id, value });
      continue;
    }
    open.push(f);
  }

  // Open questions: AI may answer motivation / experience questions from the resume; personal facts are always asked.
  const missing: Missing[] = [];
  let aiAnswers: Record<string, string> = {};
  const askable = open.filter((f) => !SENSITIVE.test(f.label.toLowerCase()));
  if (aiConfigured() && askable.length) {
    const out = await claude(
      `You fill job-application questions for a candidate, using ONLY the facts provided. For each field return a value or the exact string "ASK".
Rules:
- Return "ASK" for anything personal you cannot verify from the facts (dates, legal history, salary, notice, location preferences, yes/no about their own circumstances, references, availability).
- Open-ended questions (why this company, describe your experience with X, anything else): write 2–4 specific, truthful sentences in first person using the resume facts and the job. Plain, human, no clichés, no exclamation marks, never mention AI.
- "How many years of experience with X": answer only if the resume clearly shows it; otherwise "ASK".
- For fields with options, return one option exactly as written.
Return ONLY JSON {"<id>": "<value or ASK>"}.`,
      [{
        role: "user",
        content: `JOB: ${ctx.job.title} at ${ctx.job.company}\n${(ctx.job.description || "").slice(0, 3000)}\n\nCANDIDATE FACTS: ${JSON.stringify({ ...ctx.facts, email: undefined, phone: undefined, address1: undefined })}\nRESUME: ${JSON.stringify(ctx.resume || {}).slice(0, 7000)}\nSAVED ANSWERS: ${JSON.stringify(ctx.answers.slice(0, 40))}\n\nFIELDS: ${JSON.stringify(askable.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options?.slice(0, 40), required: f.required })))}`,
      }],
      2500,
      { model: "fast", temperature: 0.2 },
    );
    aiAnswers = extractJson<Record<string, string>>(out) || {};
  }
  for (const f of open) {
    const v = aiAnswers[f.id];
    if (v && v !== "ASK") {
      if (f.options?.length) {
        const opt = bestOption(f.options, v);
        if (opt) {
          fills.push({ id: f.id, value: opt });
          continue;
        }
      } else {
        fills.push({ id: f.id, value: v });
        continue;
      }
    }
    if (f.required) missing.push({ id: f.id, qkey: qkeyOf(f.label), label: f.label.replace(/\s*\*\s*$/, ""), type: f.type, options: f.options, required: true });
  }
  return { fills, missing };
}
