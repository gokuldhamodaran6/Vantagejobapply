import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { authorisedNow, needsSponsorshipLater, workAuthAnswers } from "@/lib/answers";
import type { ResumeContent, WorkAuth } from "@/lib/types";

/** A form control the worker found on an employer's application page. */
export type FormField = {
  id: string; // worker-assigned handle
  label: string;
  type: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "combobox" | "radio" | "checkbox" | "checkboxes" | "file" | "password" | "buttons";
  name?: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  section?: string;
};

export type Fill = { id: string; value?: string; file?: "resume" | "cover_letter"; check?: boolean };
export type Missing = { id: string; qkey: string; label: string; type: FormField["type"]; options?: string[]; required: boolean; kind?: "consent" };

export type Facts = {
  first_name: string; last_name: string; full_name: string; preferred_name: string;
  email: string; phone: string; linkedin: string; github: string; website: string;
  address1: string; city: string; state: string; postal: string; country: string; location: string;
  current_company: string; current_title: string; school: string; degree: string; major: string; grad_year: string;
  years_experience: string; salary: string; start: string; notice: string; relocate: string; heard_from: string;
  gender: string; race: string; hispanic: string; veteran: string; disability: string; pronouns: string;
  work_authorized: string; sponsorship: string; sponsorship_detail: string; work_status: string;
  preferred_locations: string; remote_ok: string;
  sponsorship_now: string; sponsorship_future: string; eeo_private: string;
};

export function qkeyOf(label: string) {
  return coreLabel(label).toLowerCase().replace(/\*|\(required\)|\(optional\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
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
  prefs?: { locations?: { city?: string; state?: string; country?: string }[] | null; remote_ok?: boolean | null } | null;
}): Facts {
  const a = input.applicant || {};
  const r = input.resume || ({ name: input.name } as ResumeContent);
  const [first, ...rest] = bestName(input.name, r.name).split(/\s+/);
  const latest = r.experience?.[0];
  const edu = r.education?.[0];
  const years = (() => {
    const ys = (r.experience || []).flatMap((e) => [e.start, e.end]).map((d) => (d && /present/i.test(d) ? new Date().getFullYear() : parseInt((d || "").match(/\d{4}/)?.[0] || "", 10))).filter((n) => !isNaN(n));
    return ys.length ? String(Math.max(0, Math.max(...ys) - Math.min(...ys))) : "";
  })();
  const auth = Object.fromEntries(workAuthAnswers(input.country, input.auth).map((x) => [x.key, x.a]));
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "") || "";
  // Fall back to the resume's "City, ST" line when the application profile hasn't been filled in yet.
  const fromResume = placeFromResume(r.location || "");
  const city = s("city") || fromResume.city;
  const state = s("state") || fromResume.state;
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
    country: s("country") || fromResume.country,
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
    preferred_locations: (input.prefs?.locations || []).map((l) => l.city || l.state || "").filter(Boolean).join(", "),
    remote_ok: input.prefs?.remote_ok ? "Yes" : "",
    // Separate, exact answers for "now" and "in the future" — an OPT holder needs no sponsorship now but will later.
    sponsorship_now: input.auth ? (authorisedNow(input.auth) ? "No" : "Yes") : "",
    sponsorship_future: input.auth ? (needsSponsorshipLater(input.auth) ? "Yes" : "No") : "",
    eeo_private: DECLINE,
  };
}

const titleCase = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : n);

/** The fullest version of the person's name: a one-word profile name ("Gokul") yields to the resume's "Gokul Dhamodaran". */
export function bestName(profileName: string | null | undefined, resumeName: string | null | undefined) {
  const p = (profileName || "").trim().replace(/\s+/g, " ");
  const r = (resumeName || "").trim().replace(/\s+/g, " ");
  const pick = p.split(" ").length >= 2 ? p : r && (!p || r.toLowerCase().startsWith(p.toLowerCase())) && r.split(" ").length >= 2 ? r : p || r;
  return titleCase(pick);
}

const US_STATE_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const CA_PROVINCES = new Set("AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" "));

/** "Bloomington, IL" → city, state and country; anything unclear is left empty (the agent asks instead of guessing). */
export function placeFromResume(loc: string): { city: string; state: string; country: string } {
  const parts = loc.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { city: "", state: "", country: "" };
  const code = parts[1].toUpperCase();
  const tail = parts[parts.length - 1].toLowerCase();
  if (US_STATE_CODES.has(code)) return { city: parts[0], state: code, country: "United States" };
  if (CA_PROVINCES.has(code)) return { city: parts[0], state: code, country: "Canada" };
  if (/^(usa|us|united states)$/.test(tail)) return { city: parts[0], state: parts.length > 2 ? parts[1] : "", country: "United States" };
  if (/^(uk|united kingdom|england|scotland|wales)$/.test(tail)) return { city: parts[0], state: "", country: "United Kingdom" };
  if (/^(canada|australia|india)$/.test(tail)) return { city: parts[0], state: parts.length > 2 ? parts[1] : "", country: tail.charAt(0).toUpperCase() + tail.slice(1) };
  return { city: "", state: "", country: "" };
}

type Rule = [RegExp, keyof Facts | "resume" | "cover_letter" | "consent" | "sms" | "full_or_first"];
const RULES: Rule[] = [
  [/\b(resume|cv|curriculum vitae)\b/, "resume"],
  [/\bcover ?letter\b/, "cover_letter"],
  // Any question about sponsorship is a sponsorship question, even when it also says "work authorization".
  [/(require|need).{0,60}sponsor|sponsorship/, "sponsorship"],
  [/authori[sz]ed to work|legally (eligible|authori[sz]ed|permitted|able) to work|right to work|eligible to work|work authori[sz]ation/, "work_authorized"],
  [/visa status|immigration status|current (work )?status/, "work_status"],
  [/^location \(city\)|^location$|^current location|city, state|^your location/, "location"],
  [/transgender|lgbt|sexual orientation|orientation\b/, "eeo_private"],
  [/(which|what) (cities|city|locations?|offices?)|cities .{0,40}(available|willing|open|work)|(available|willing|open) to work (in|from)|preferred (work )?(location|office)|office location|location preference/, "preferred_locations"],
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

const SHORT_FACTS = new Set(["first_name", "last_name", "full_name", "preferred_name", "email", "phone", "linkedin", "github", "website", "address1", "city", "state", "postal", "country", "location", "current_company", "current_title", "school", "degree", "major", "grad_year", "pronouns", "salary", "notice", "start"]);

/**
 * "Will you now require sponsorship?" and "Will you in the future…?" get different, exact answers.
 * A question that asks about both (or doesn't say) is "Yes" if either is yes.
 */
export function sponsorshipFor(label: string, facts: Facts): string | null {
  const now = /\bnow\b|currently|at this time|to (start|begin)|today|immediately/.test(label);
  const future = /future|later|at any (point|time)|eventually|going forward/.test(label);
  const n = facts.sponsorship_now, fu = facts.sponsorship_future;
  if (now && !future) return n || null;
  if (future && !now) return fu || null;
  if (!n && !fu) return null;
  return n === "Yes" || fu === "Yes" ? "Yes" : "No";
}

/** A field's label without required-markers and without the duplicate that aria-labelledby + <label for> produce. */
export function coreLabel(label: string) {
  // Validation text that sites append ("This field is required") and hints in brackets ("(Street address, P.O. Box…)")
  // are not part of the question.
  let t = label.replace(/\*|\(required\)/gi, " ").replace(/\b(this field is required|this is a required field|required field|please (enter|fill in|complete) [^.]{0,40}|is required)\.?/gi, " ").replace(/\s+/g, " ").trim();
  const noHint = t.replace(/\s*\([^)]{2,80}\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (noHint.length >= 3 && noHint.length < t.length && /[a-z]/i.test(noHint)) t = noHint;
  const m = t.match(/^(.{3,}?)\s+\1$/i);
  return (m ? m[1] : t).trim();
}

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
  if (no) return opts.find((o) => /^no\b/i.test(o.trim())) || opts.find((o) => /\b(never|have not|haven't|i am not|not (a |an )?(current|previous|former))\b/i.test(o) && !/\byes\b/i.test(o)) || null;
  if (/decline|don.?t wish|prefer not|not to (say|answer|disclose)/.test(w)) {
    return opts.find((o) => /decline|don.?t wish|prefer not|not to (say|answer|disclose|self)|choose not|(do not|don.?t) want to (answer|say|disclose|identify)|rather not/i.test(o)) || null;
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
    const core = coreLabel(f.label);
    const yesNo = (f.options || []).filter((o) => !/^(select|choose|please select|--)/i.test(o.trim())).every((o) => /^(yes|no)\b/i.test(o.trim())) && (f.options || []).length > 0;
    // Short personal facts (name, city, country, school…) only answer short labels — never a question that merely mentions them,
    // and never a Yes/No question.
    // Passport, nationality and citizenship are never inferred from where someone lives: only their own saved answer.
    const identity = /passport|nationality|citizenship|citizen of|country of (birth|origin)|place of birth/.test(label);
    const rule = identity ? undefined : RULES.find(([re, key]) => re.test(label) && !(SHORT_FACTS.has(key) && (core.length > 60 || yesNo)));
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
    const formerly = /(previously|ever|formerly|currently) (been )?(employed|worked|work) (by|for|at)|have you (ever )?(been employed|worked) (at|for|by)|former employee|worked (here|for us) before/.test(label) && !/relative|family|friend|refer/.test(label);
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
      } else if (key === "preferred_locations") {
        const mine = ctx.facts.preferred_locations.split(/,\s*/).filter(Boolean);
        if (f.options?.length) {
          const n = (x: string) => x.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
          const hit = f.options.find((o) => mine.some((m) => n(o).includes(n(m)) || n(m).includes(n(o)))) || (ctx.facts.remote_ok ? f.options.find((o) => /remote/i.test(o)) : undefined);
          if (hit) {
            fills.push({ id: f.id, value: hit });
            continue;
          }
        } else if (mine.length) value = mine.join(", ") + (ctx.facts.remote_ok ? ", or remote" : "");
      } else if (key === "sms") {
        if (f.type === "checkbox") continue; // never opt in to marketing texts
        value = "No";
      } else if (key !== "resume" && key !== "cover_letter" && key !== "full_or_first") {
        value = ctx.facts[key] || null;
        if (key === "sponsorship") value = sponsorshipFor(label, ctx.facts);
        if (key === "work_authorized" && f.options?.length && value) {
          value = /^yes/i.test(value) ? "Yes" : "No";
          // "Yes, no restriction" vs "Yes, but I need sponsorship": pick the one that's true for this person, or ask.
          const yesOpts = f.options.filter((o) => /^yes\b/i.test(o.trim()));
          if (value === "Yes" && yesOpts.length > 1) {
            const needs = ctx.facts.sponsorship_future === "Yes" || ctx.facts.sponsorship_now === "Yes";
            const limited = yesOpts.find((o) => /sponsor|visa|restrict|temporar|require|permit|\bopt\b|\bead\b|limited/i.test(o) && !/no restriction|without (any )?(restriction|sponsorship)|unrestricted/i.test(o));
            const full = yesOpts.find((o) => /no restriction|without (any )?(restriction|sponsorship)|unrestricted|citizen|permanent/i.test(o));
            value = (needs ? limited : full) || null;
          }
        }
      }
    }

    if (value) {
      if (f.options?.length) {
        let opt = bestOption(f.options, value);
        // "How did you hear about us?" lists differ per company: prefer their careers page, then "Other".
        if (!opt && rule?.[1] === "heard_from" && !saved) opt = f.options.find((o) => /career|company (web)?site|website|job site|direct/i.test(o)) || f.options.find((o) => /^other\b/i.test(o.trim())) || null;
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
  // Certifications, legal, eligibility and identity questions are never answered by AI: only by the user's own saved answers.
  const isConsent = (f: FormField) => /privacy|consent|i agree|acknowledge|terms|certify|attest|accurate and complete|true and correct|data (processing|retention)|i understand/.test(f.label.toLowerCase());
  const NO_AI = /passport|nationality|citizen|age of|years of age|\b18\b|cities|city|location|relocat|on-?site|in the office|commut|travel|authori[sz]ed to work|eligible to work|right to work|sponsor|visa|citizen|immigration|green card|clearance|export control|itar|us person|veteran|disabilit|gender|\brace\b|ethnic|hispanic|pronoun|salary|compensation/;
  const askable = open.filter((f) => !SENSITIVE.test(f.label.toLowerCase()) && !NO_AI.test(f.label.toLowerCase()) && !isConsent(f));
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
        content: `JOB: ${ctx.job.title} at ${ctx.job.company}\n${(ctx.job.description || "").slice(0, 3000)}\n\nCANDIDATE FACTS: ${JSON.stringify(aiFacts(ctx.facts))}\nRESUME: ${JSON.stringify(ctx.resume || {}).slice(0, 7000)}\nSAVED ANSWERS: ${JSON.stringify(relevantAnswers(ctx.answers, askable))}\n\nFIELDS: ${JSON.stringify(askable.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options?.slice(0, 40), required: f.required })))}`,
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
    if (f.required) missing.push({ id: f.id, qkey: qkeyOf(f.label), label: coreLabel(f.label), type: f.type, options: f.options, required: true, ...(isConsent(f) ? { kind: "consent" as const } : {}) });
  }
  return { fills, missing };
}

/** Only professional facts go to the AI — never contact details, demographics or immigration status. */
function aiFacts(f: Facts) {
  return {
    current_company: f.current_company, current_title: f.current_title, school: f.school, degree: f.degree, major: f.major, grad_year: f.grad_year,
    years_experience: f.years_experience, city: f.city, state: f.state, country: f.country, relocate: f.relocate, start: f.start, notice: f.notice,
    preferred_locations: f.preferred_locations, remote_ok: f.remote_ok,
  };
}

/** Only saved answers that share meaningful words with the fields being asked go to the AI. */
function relevantAnswers(answers: { qkey: string; question: string; answer: string }[], fields: FormField[]) {
  const stop = new Set(["you", "your", "have", "are", "the", "and", "for", "with", "what", "this", "that", "will", "any", "how", "did", "please", "describe"]);
  const words = new Set(fields.flatMap((f) => qkeyOf(f.label).split(" ")).filter((w) => w.length > 3 && !stop.has(w)));
  return answers.filter((a) => !SENSITIVE.test(a.qkey) && !/sponsor|visa|citizen|veteran|disabilit|gender|race|ethnic|hispanic|salary/.test(a.qkey) && a.qkey.split(" ").some((w) => words.has(w))).slice(0, 12);
}
