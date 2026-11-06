/**
 * The cover-letter writer that works with no AI at all (and the plan the AI writer can lean on).
 *
 * A recruiter skims a letter for three things in about ten seconds: does this person understand what the job is for,
 * have they done it before (with numbers), and are they specific to us. So the letter is built from the posting:
 *   1. Opening: what the company is hiring for, in the posting's own words, and the candidate's closest credential.
 *   2. Proof: the 2 strongest results for this kind of role, chosen by relevance and numbers, never filler.
 *   3. First months: what they would do, tied to the posting's responsibilities, and how they'd measure it.
 *   4. Close: a confident invitation, no begging.
 * Every claim about the past is a bullet from the person's own resume, kept with its original numbers and credit.
 */
import type { LetterTone, ResumeContent } from "@/lib/types";

type Job = { title: string; company: string; description: string | null; country?: string };
type Exp = NonNullable<ResumeContent["experience"]>[number];

/* ------------------------------------------------------------------ */
/* What kind of role this is                                           */
/* ------------------------------------------------------------------ */

type Family = {
  key: string;
  test: RegExp;
  /** Words that make a result relevant to this kind of role. */
  words: string[];
  /** The work, as a short noun phrase ("growth marketing"). */
  field: string;
  /** How they'd measure the first months (one full sentence). */
  measure: string;
  /** What the role is for, when the posting gives us nothing better. */
  purpose: string;
  /** Candidate job titles that mean they've done this exact work (otherwise the letter frames it as a move). */
  core: RegExp;
  /** What the first months start from ("Hex's pipeline"). */
  noun: string;
  /** Titles that mean this is exactly their job, so the letter can say so plainly. */
  exact: RegExp;
};

const FAMILIES: Family[] = [
  {
    key: "demand",
    test: /\b(growth|demand|acquisition|performance|paid|abm|account[- ]based|lead gen|pipeline|user acquisition)\b/i,
    words: ["pipeline", "lead", "leads", "revenue", "roas", "cpl", "cpa", "paid", "ads", "google", "linkedin", "meta", "campaign", "campaigns", "abm", "account-based", "demand", "funnel", "conversion", "budget", "a/b", "test", "tests", "acquisition", "deal", "growth", "attribution"],
    field: "B2B growth and demand-generation marketing",
    measure: "Every week, I would report progress against pipeline, cost per lead and conversion, and move budget to what works.",
    purpose: "turn marketing spend into qualified pipeline",
    core: /marketing|growth|demand/i,
    exact: /growth|demand|performance|acquisition/i,
    noun: "pipeline and channel mix",
  },
  {
    key: "content",
    test: /\b(content|copywrit|editorial|writer|storytell|social media|community|brand)\b/i,
    words: ["content", "seo", "website", "copy", "video", "videos", "social", "blog", "articles", "impressions", "traffic", "organic", "brand", "creative", "creatives", "keyword", "wordpress", "engagement", "calendar", "following"],
    field: "content, SEO and brand marketing",
    measure: "Every piece would be judged by the organic traffic, engagement and pipeline it brings in.",
    purpose: "build content that ranks, gets read and brings in pipeline",
    core: /marketing|content|communications|brand|social/i,
    exact: /content|seo|brand|social|copy/i,
    noun: "content library and search performance",
  },
  {
    key: "analytics",
    test: /\b(analyst|analytics|insights?|data|business intelligence|bi\b|reporting|operations research|quantitative)\b/i,
    words: ["sql", "python", "power bi", "tableau", "dashboards", "dashboard", "reporting", "reports", "analyzed", "analysis", "data", "metrics", "kpi", "forecast", "model", "automated", "excel", "attribution", "insights"],
    field: "marketing and business analytics",
    measure: "Every metric would get a clear definition first, then a weekly read-out leaders can act on.",
    purpose: "turn data into decisions leaders can act on",
    core: /analyst|analytics|data|insights/i,
    exact: /analyst|analytics|data|insights/i,
    noun: "data, reporting and open questions",
  },
  {
    key: "product",
    test: /\b(product manager|product owner|product marketing|pm\b|program manager)\b/i,
    words: ["built", "launched", "users", "release", "roadmap", "requirements", "product", "platform", "customers", "tests", "data", "dashboards"],
    field: "product, growth and analytics work",
    measure: "Each sprint would start with a few agreed success metrics and end with what the data shows.",
    purpose: "ship the right things and prove they work",
    core: /product/i,
    exact: /product/i,
    noun: "roadmap and product data",
  },
  {
    key: "sales",
    test: /\b(sales|account executive|business development|bdr|sdr|account manager|partnerships?)\b/i,
    words: ["revenue", "deal", "deals", "pipeline", "accounts", "sales", "calling", "cold", "clients", "customers", "closed", "close", "partner", "funds", "growth", "leads"],
    field: "B2B revenue and pipeline growth",
    measure: "Every week, I would track pipeline, conversion and win rate, and adjust where accounts stall.",
    purpose: "open new accounts and grow revenue",
    core: /sales|account executive|business development|account manager/i,
    exact: /sales|account executive|business development|account manager/i,
    noun: "pipeline and target accounts",
  },
  {
    key: "marketing",
    test: /\bmarketing|communications?|events?\b/i,
    words: ["campaign", "campaigns", "revenue", "pipeline", "events", "website", "seo", "social", "leads", "brand", "budget", "content", "dashboards"],
    field: "B2B marketing",
    measure: "Each program would have a clear goal and a weekly results read-out.",
    purpose: "grow awareness, pipeline and revenue",
    core: /marketing|communications/i,
    exact: /marketing|communications/i,
    noun: "marketing plan and results",
  },
];

export function familyOf(job: Pick<Job, "title" | "description">): Family {
  for (const f of FAMILIES) if (f.test.test(job.title)) return f;
  const d = (job.description || "").slice(0, 3000);
  let best = FAMILIES[FAMILIES.length - 1];
  let hits = 0;
  for (const f of FAMILIES) {
    const n = (d.match(new RegExp(f.test.source, "gi")) || []).length;
    if (n > hits) [best, hits] = [f, n];
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Reading the posting                                                 */
/* ------------------------------------------------------------------ */

const VERBS = "own|build|drive|lead|develop|manage|create|run|scale|plan|analy[sz]e|deliver|partner|define|execute|design|launch|write|grow|optimi[sz]e|stand up|establish|produce|support|track|report|identify|improve|oversee|shape|craft|translate|collaborate|work|use|conduct|prepare|maintain|monitor|coordinate|prospect|sell|close|generate|research|test|measure|turn|help|bring|deploy|make";
const VERB_START = new RegExp(`^(${VERBS})\\b`, "i");

/** Clean, short responsibility phrases from the posting, each starting with a base verb ("own demand generation end-to-end"). */
export function responsibilities(description: string | null): string[] {
  if (!description) return [];
  const lines = description
    .split(/\n|(?<=[.;])\s+(?=[A-Z])|\s(?=[ivx]+\)\s)/)
    .map((l) => l.replace(/^\s*(?:[-*•·▪◦]|\d+[.)]|[ivx]+\))\s*/i, "").trim())
    .filter((l) => l.length > 12 && l.length < 400);
  const out: string[] = [];
  for (let l of lines) {
    l = l.replace(/^(you will|you'll|you would|in this role,? you will|the role will|responsibilities include)\s*:?\s*/i, "");
    // "Own demand generation end-to-end: Build and execute..." -> the label is the cleanest phrase.
    const label = l.match(/^([^:]{8,70}):/)?.[1];
    if (label && VERB_START.test(label)) l = label;
    if (!VERB_START.test(l)) continue;
    // Keep the first idea only: stop at a colon, semicolon, dash aside or "including"/"such as".
    l = l.split(/[:;]| — | – | - (?=[a-z])|,? including |,? such as |\(/)[0];
    // One clean idea: stop before a purpose clause or a list, and keep it short enough to read in a breath.
    l = l.replace(/\s+(to achieve|in order to|so that|that will|which|while|to ensure|to maximi[sz]e|to drive|to support|to deliver)\b.*$/i, "");
    const words = l.split(/\s+/);
    if (words.length > 11 || /,/.test(l)) {
      const comma = l.indexOf(",");
      if (comma > 20) l = l.slice(0, comma);
    }
    if (l.split(/\s+/).length > 10) {
      const m = l.match(/^(.{20,}?)\s+(across|through|for|with|by|from|within|at)\s/i);
      if (m && m[1].split(/\s+/).length >= 4) l = m[1];
    }
    if (l.split(/\s+/).length > 12) l = l.split(/\s+/).slice(0, 12).join(" ").replace(/\s+(and|or|the|a|an|of|to|for|with|across|in|on)$/i, "");
    l = l.replace(/[\s,.]+$/, "").replace(/\s+/g, " ");
    l = l.charAt(0).toLowerCase() + l.slice(1);
    if (l.split(" ").length < 3 || /\b(we|our|us|you|your)\b/i.test(l)) continue;
    if (!out.some((o) => o.slice(0, 18) === l.slice(0, 18))) out.push(l);
    if (out.length >= 8) break;
  }
  return out;
}

/** "Ring's mission is to make neighborhoods safer" -> { who: "Ring", what: "make neighborhoods safer" }. */
export function missionOf(description: string | null, company: string, team = ""): { who: string; what: string } | null {
  if (!description) return null;
  const m = description.slice(0, 2500).match(/(?:^|[.\n]\s*)((?:[A-Z][\w&.-]*\s?){1,4})(?:'s|’s)\s+mission is to ([^.;\n]{8,140})|(?:^|[.\n]\s*)Our mission is to ([^.;\n]{8,140})/);
  if (!m) return null;
  let what = (m[2] || m[3] || "").trim();
  what = what.replace(/\s+(to|for)\s+(customers|people|businesses|communities|everyone)\b.*$/i, "").replace(/,?\s+and\s+.*$/i, "");
  if (what.split(/\s+/).length > 10) what = what.split(/\s+/).slice(0, 10).join(" ").replace(/\s+\S+$/, "");
  if (!/^[a-z]/.test(what) || what.split(/\s+/).length < 2) return null;
  // "Our mission" belongs to the named team when it is a product of the company ("Amazon Leo"), else the company.
  const named = team && team.toLowerCase().includes(company.toLowerCase()) ? team : company;
  return { who: (m[1] || "").trim() || named, what };
}

/** "Sr. Growth Marketing Manager, Ring Business" -> role + team; "Growth Marketing Manager - Paid Marketing" -> role + focus. */
export function splitTitle(title: string): { role: string; team: string } {
  const t = title.replace(/\s+/g, " ").trim();
  const comma = t.match(/^(.{6,}?),\s*(.{3,})$/);
  if (comma) return { role: comma[1].trim(), team: comma[2].trim() };
  const dash = t.match(/^(.+?)\s[-–—|]\s(.+)$/);
  if (dash && dash[1].split(" ").length >= 2) return { role: dash[1].trim(), team: dash[2].trim() };
  return { role: t, team: "" };
}

/** "Dayforcehcm" -> "Dayforcehcm" stays (we can't guess), but "hex" -> "Hex" and "Acme, Inc." -> "Acme". */
export function tidyCompany(c: string): string {
  let s = (c || "").replace(/\s+/g, " ").trim().replace(/,?\s+(inc\.?|llc|ltd\.?|corp\.?|corporation|co\.)$/i, "");
  // Names read off a careers domain ("dayforcehcm", "acmehq", "acmecareers") lose the domain suffix.
  if (/^[A-Za-z]{6,}$/.test(s)) {
    const cut = s.replace(/(hcm|hq|careers|jobs|inc)$/i, "");
    if (cut.length >= 3) s = cut;
  }
  if (s && s === s.toLowerCase()) s = s.replace(/(^|\s)([a-z])/g, (_, p, ch) => p + ch.toUpperCase());
  return s;
}

/* ------------------------------------------------------------------ */
/* Choosing the proof                                                  */
/* ------------------------------------------------------------------ */

const STUDENT_ROLE = /\b(assistant|aide|intern|student|tutor|volunteer|fellow)\b/i;
const NUM = /\d/;
const MONEY = /[$€£₹]\s?\d|\d\s?(k|m|b|million|billion)\b/i;

type Proof = { text: string; e: Exp; score: number; hits: string[] };

function proofs(r: ResumeContent, fam: Family, job: Job): Proof[] {
  const jd = ` ${(job.title + " " + (job.description || "")).toLowerCase()} `;
  const exp = (r.experience || []).filter((e) => !e.brief && (e.bullets || []).length);
  const educationJob = /\b(teach|school|education|university|academic|student)\b/i.test(job.title);
  const list: Proof[] = [];
  exp.forEach((e, i) => {
    const studentish = STUDENT_ROLE.test(e.title || "") && !educationJob;
    for (const b of e.bullets || []) {
      const low = ` ${b.toLowerCase()} `;
      if (/^promoted\b/i.test(b.trim())) continue;
      const hits = fam.words.filter((w) => low.includes(` ${w}`) || low.includes(`${w} `));
      const jdHits = (low.match(/[a-z][a-z/+-]{3,}/g) || []).filter((w) => jd.includes(` ${w} `) && !STOP.has(w));
      let score = (NUM.test(b) ? 3 : 0) + (MONEY.test(b) ? 2.5 : 0) + (/\b\d+(\.\d+)?x\b|\d+%/i.test(b) ? 1.5 : 0) + hits.length * 1.4 + Math.min(4, new Set(jdHits).size * 0.5);
      score += Math.max(0, 2 - i * 0.4); // recent roles first, gently
      if (studentish) score -= 6;
      list.push({ text: b, e, score, hits });
    }
  });
  return list.sort((a, b) => b.score - a.score);
}

const STOP = new Set(["with", "from", "that", "this", "have", "will", "your", "their", "across", "into", "each", "every", "through", "about", "more", "than", "were", "they", "them", "what", "when", "which", "while", "work", "team", "teams", "role"]);

function pickProofs(r: ResumeContent, fam: Family, job: Job, n: number): Proof[] {
  const all = proofs(r, fam, job);
  const out: Proof[] = [];
  const perCompany = new Map<string, number>();
  for (const p of all) {
    const k = p.e.company || p.e.title || "";
    if ((perCompany.get(k) || 0) >= 2) continue;
    // Don't use two results that say the same thing.
    if (out.some((o) => overlap(o.text, p.text) > 0.5)) continue;
    out.push(p);
    perCompany.set(k, (perCompany.get(k) || 0) + 1);
    if (out.length >= n) break;
  }
  return out;
}

function overlap(a: string, b: string) {
  const A = new Set(a.toLowerCase().match(/[a-z0-9$%]{4,}/g) || []);
  const B = new Set(b.toLowerCase().match(/[a-z0-9$%]{4,}/g) || []);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / Math.min(A.size, B.size);
}

/** A resume bullet as a sentence in the letter: "At Kaar Tech, I planned and ran ...". Same facts, same credit. */
export function proofSentence(p: Proof, lead = true): string {
  let b = p.text.trim().replace(/[.;]\s*$/, "");
  // Long tool lists in brackets read as keyword stuffing in a letter.
  b = b.replace(/\s*\(([^)]*,){2,}[^)]*\)/g, "");
  // Over-long bullets: keep the part that carries the result.
  const words = b.split(/\s+/);
  if (words.length > 34) {
    const parts = b.split(/;\s+|,\s+and\s+(?=[a-z]+ed\b)/);
    const keep = parts.find((x) => NUM.test(x)) || parts[0];
    b = keep;
  }
  b = b.replace(/;\s+/g, ", and ");
  const verb = b.charAt(0).toLowerCase() + b.slice(1);
  const where = p.e.company ? p.e.company.split(",")[0] : "";
  // A second result from the same employer reads "There, I also ..." so the letter never repeats "At X, I".
  const s = lead && where ? `At ${where}, I ${verb}` : `There, I also ${verb}`;
  return `${s}.`;
}

/* ------------------------------------------------------------------ */
/* The candidate                                                       */
/* ------------------------------------------------------------------ */

function yearsOf(r: ResumeContent): string {
  const said = (r.summary || "").match(/\b(\d{1,2}\+?)\s+years\b/i)?.[1];
  if (said) return said;
  // Only full roles count (not internships or student jobs), and never more than the resume can support.
  const ys = (r.experience || [])
    .filter((e) => !e.brief && !STUDENT_ROLE.test(e.title || ""))
    .flatMap((e) => [e.start, e.end])
    .map((d) => (d && /present/i.test(d) ? new Date().getFullYear() : parseInt((d || "").match(/\d{4}/)?.[0] || "", 10)))
    .filter((n) => !isNaN(n));
  if (!ys.length) return "";
  const n = Math.max(...ys) - Math.min(...ys);
  return n >= 2 ? `${n}+` : "";
}

/** The role that carries the candidate's credibility: the latest real job with measurable results. */
function anchorRole(r: ResumeContent): Exp | undefined {
  const exp = (r.experience || []).filter((e) => !e.brief);
  return exp.find((e) => !STUDENT_ROLE.test(e.title || "") && (e.bullets || []).some((b) => NUM.test(b))) || exp[0];
}

/** "I am completing an MBA in X at Y (graduating Dec 2026)." Shows availability and current skills, honestly. */
function currentStudy(r: ResumeContent): string {
  const ed = (r.education || []).find((e) => /expected|present|current/i.test(`${e.end || ""}`));
  if (!ed?.degree) return "";
  const when = `${ed.end || ""}`.replace(/^\s*(expected|exp\.?)\s*/i, "").trim();
  const degree = ed.degree.replace(/^(MBA|MS|MSc|MA|BS|BA|PhD|MEng),\s*/i, "$1 in ");
  return `Alongside that work, I am completing ${an(degree)} ${degree}${ed.school ? ` at ${ed.school}` : ""}${when && !/present|current/i.test(when) ? `, graduating in ${when}` : ""}.`;
}

/* ------------------------------------------------------------------ */
/* The letter                                                          */
/* ------------------------------------------------------------------ */

/** "an MBA", "an SMB lead", "a Senior", "an Analyst", "a UX". */
const an = (w: string) => {
  const acr = w.match(/^([A-Z]{2,})\b/)?.[1];
  if (acr) return /^[AEFHILMNORSX]/.test(acr) ? "an" : "a";
  return /^[aeiou]/i.test(w) && !/^(uni|use|one|eu)/i.test(w) ? "an" : "a";
};

export function writeLetter(r: ResumeContent, job: Job, tone: LetterTone = "confident"): string {
  const company = tidyCompany(job.company) || "your team";
  const { role, team } = splitTitle(job.title);
  const fam = familyOf(job);
  // The first listed responsibility is the heart of the job; the rest are ranked by fit for the first-months plan.
  const listed = responsibilities(job.description);
  const resp = [listed[0], ...listed.slice(1).sort((a, b) => relevance(b, fam) - relevance(a, fam))].filter(Boolean);
  const years = yearsOf(r);
  const anchor = anchorRole(r);
  const [p0, p1, p2] = pickProofs(r, fam, job, 3);
  const study = currentStudy(r);

  // 1. Opening: what they're hiring for, in their words, then the closest credential.
  const forTeam = team && !/^(remote|hybrid|onsite|us|usa|united states)$/i.test(team) ? ` for ${team}` : "";
  const why = resp[0] ? resp[0] : fam.purpose;
  const odd = /\s[-/|]\s|^\W/.test(role);
  const open = odd ? `${company} is hiring for its ${job.title.trim()} role to ${why}.` : `${company} is hiring ${an(role)} ${role}${forTeam} to ${why}.`;
  const at = anchor ? `${anchor.title}${anchor.company ? ` at ${anchor.company.split(",")[0]}` : ""}` : "";
  const done = (r.experience || []).some((e) => !e.brief && !STUDENT_ROLE.test(e.title || "") && fam.core.test(e.title || ""));
  const mine = anchor && /marketing|growth/i.test(anchor.title || "") ? "B2B marketing" : anchor && /analyst/i.test(anchor.title || "") ? "analytics" : "my field";
  // Honest framing: "this is my work" only when their titles say so; otherwise it's a move from neighbouring work.
  const exact = anchor && fam.exact.test(anchor.title || "");
  const cred = done
    ? years
      ? exact
        ? `That is the work I have done for the last ${years} years in ${fam.field}${at ? `, most recently as ${at}` : ""}.`
        : `That work has been a core part of my ${years} years in ${mine}${at ? `, most recently as ${at}` : ""}.`
      : at ? `That is the work I did as ${at}.` : ""
    : years
      ? `I come to this role from ${years} years in ${mine}, where my work was measured in pipeline and revenue${at ? `, most recently as ${at}` : ""}.`
      : at ? `I come to this role from ${mine}, most recently as ${at}.` : "";
  const P1 = [open, cred].filter(Boolean).join(" ");

  // 2. Proof: the strongest results for this kind of role.
  let chosen = [p0, p1].filter(Boolean) as Proof[];
  if (p2 && words(chosen.map((p) => p.text).join(" ")) < 60) chosen.push(p2);
  // Keep results from the same employer together, strongest employer first.
  const order = [...new Set(chosen.map((p) => p.e.company))];
  chosen = order.flatMap((c) => chosen.filter((p) => p.e.company === c));
  const P2 = chosen.map((p, i) => proofSentence(p, i === 0 || p.e.company !== chosen[i - 1].e.company)).join(" ");

  // 3. First months: their responsibilities, our way of measuring.
  const plan = resp.slice(1, 3).filter((x) => x !== why);
  const first = plan.length
    ? `In my first months, I would ${plan[0]}${plan[1] ? `, then ${plan[1]}` : ""}. ${fam.measure}`
    : `In my first months, I would take stock of ${company}'s ${fam.noun}. ${fam.measure}`;
  const P3 = [first, study].filter(Boolean).join(" ");

  // 4. Close.
  const area = team || (fam.key === "analytics" ? "analytics" : fam.key === "content" ? "content" : fam.key === "sales" ? "growth" : "marketing");
  const mission = missionOf(job.description, company, team);
  const P4 = mission
    ? `I would welcome a conversation about how I can help ${mission.who.replace(/^(Our|The)$/i, company)} ${mission.what}. ${tone === "formal" ? "Thank you for your consideration." : "Thank you for your time."}`
    : tone === "formal"
      ? `I would welcome the opportunity to discuss ${company}'s plans for ${area} and how my experience can support them. Thank you for your consideration.`
      : `I would welcome a conversation about where ${company} wants to take ${area} next and how I can help get it there. Thank you for your time.`;

  const sign = tone === "warm" ? "Best regards," : "Sincerely,";
  const greet = company === "your team" ? "Dear Hiring Manager," : `Dear ${company} Hiring Team,`;
  return [greet, P1, P2, P3, P4, `${sign}\n${r.name || ""}`].filter((x) => x && x.trim()).join("\n\n");
}

function relevance(phrase: string, fam: Family) {
  // Judge the object, not the verb ("lead market research" is not about leads).
  const low = ` ${phrase.toLowerCase().replace(/^\S+\s+/, "")} `;
  return fam.words.filter((w) => low.includes(` ${w}`)).length + (/\b(own|lead|build|drive|scale)\b/.test(low) ? 0.5 : 0);
}

function words(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

