import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { extractKeywords, resumeText, scoreResume } from "@/lib/ats";
import { parseResumeText } from "@/lib/resume/parse";
import { LETTER_TONES } from "@/lib/resume/styles";
import type { LetterTone, ResumeContent } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Shared rules                                                        */
/* ------------------------------------------------------------------ */

const TRUTH = `NON-NEGOTIABLE TRUTH RULES
- Use only facts present in the candidate's resume. Never invent employers, titles, dates, degrees, tools, certifications, metrics, team sizes or outcomes.
- You may rephrase, merge, reorder, trim and emphasise existing facts, and use the job's vocabulary when the resume already shows that work.
- Numbers: keep every number exactly as given. Never add a number that is not in the resume.
- If a requirement is not supported by the resume, leave it out. Do not imply experience the candidate does not have.`;

const RESUME_CRAFT = `RESUME CRAFT (what top recruiters and hiring managers reward)
- Bullets follow "accomplished [X] as measured by [Y] by doing [Z]" when the facts allow. Lead with the outcome, then the how.
- Start every bullet with a strong, specific past-tense verb (present tense for a current role). Vary verbs; never repeat the same opening verb within a role.
- No first person (I, my, we), no "Responsible for", "Helped", "Worked on", "Tasked with", no filler adjectives (dynamic, passionate, results-driven, hard-working, detail-oriented, team player).
- One idea per bullet, 1–2 lines (under ~200 characters). Most relevant bullets first. 3–5 bullets for recent roles, 1–3 for older or less relevant ones.
- Summary: 2–3 lines, no pronouns. Who they are (target-role language + years of experience computed from dates), their sharpest specialism, and 1–2 signature results with real numbers.
- Headline: the target role title plus 2–3 core specialisms separated by " | " (only specialisms the resume proves).
- Skills: 3–5 groups with standard names (e.g. "Marketing", "Analytics", "Tools", "Languages"). Most relevant first. Remove items irrelevant to the target. No soft skills in the skills section.
- Keep all jobs (no unexplained gaps); keep dates exactly. Keep standard section names so every ATS can parse it.
- Spelling: follow the job's country (US vs UK/Commonwealth spelling).`;

const BANNED = [
  "i am writing to express", "i am excited to apply", "i am thrilled", "i'm thrilled", "passionate about", "dynamic", "synergy", "go-getter", "team player",
  "hard-working", "hardworking", "detail-oriented", "results-driven", "i believe i would be a great fit", "perfect fit", "leverage my skills",
  "fast-paced environment", "esteemed", "to whom it may concern", "dear sir", "dear madam", "delve", "tapestry", "testament to", "in today's",
  "ever-evolving", "unwavering", "spearheaded a culture", "i am confident that i", "look no further", "game-changer", "cutting-edge", "seamlessly",
  "rest assured", "embark", "journey", "realm", "elevate", "foster a culture", "aligns perfectly", "resonates deeply", "honed", "invaluable",
];

/* ------------------------------------------------------------------ */
/* Structuring an uploaded/pasted resume                               */
/* ------------------------------------------------------------------ */

const SCHEMA = `{"name":string,"headline":string,"location":string,"email":string,"phone":string,"links":string[],"summary":string,"skills":[{"group":string,"items":string[]}],"experience":[{"title":string,"company":string,"location":string,"start":string,"end":string,"bullets":string[]}],"projects":[{"name":string,"tech":string,"bullets":string[]}],"education":[{"degree":string,"school":string,"location":string,"end":string,"details":string}],"certifications":string[],"awards":string[],"additional":string[]}`;

export async function structureResume(raw: string, name: string): Promise<{ content: ResumeContent; ai: boolean }> {
  const parsed = parseResumeText(raw, name);
  if (!aiConfigured()) return { content: parsed, ai: false };
  const out = await claude(
    `You convert resume text (extracted from a PDF or Word file, so lines may be wrapped mid-sentence and dates may sit at the end of lines) into clean JSON.
Copy facts VERBATIM: do not rewrite, improve, summarise or invent anything. Only repair line-wraps, hyphenation and spacing.
- Each experience entry = one job. Put the job title in "title" and the employer in "company" (never swap them). Dates as "Mon YYYY" or "YYYY"; current job end = "Present".
- Bullets: one array item per bullet, re-joined if wrapped across lines.
- Education entries: degree (with major) in "degree", institution in "school".
- Awards/honours go in "awards"; languages, volunteering, interests in "additional".
- Omit fields you cannot find (use "" or []).
Return ONLY JSON matching: ${SCHEMA}`,
    [{ role: "user", content: raw.slice(0, 24000) }],
    6000,
    { model: "writer", temperature: 0 },
  );
  const ai = extractJson<ResumeContent>(out);
  if (!ai || !ai.experience) return { content: parsed, ai: false };
  // Guard: any bullet that isn't (nearly) in the source text is dropped.
  const src = norm(raw);
  ai.experience = ai.experience.map((e) => ({ ...e, bullets: (e.bullets || []).filter((b) => coverage(b, src) >= 0.8) }));
  ai.email ||= parsed.email;
  ai.phone ||= parsed.phone;
  ai.links = ai.links?.length ? ai.links : parsed.links;
  ai.name ||= parsed.name;
  return { content: clean(ai), ai: true };
}

/* ------------------------------------------------------------------ */
/* Role-specific master resume                                         */
/* ------------------------------------------------------------------ */

export async function roleResume(master: ResumeContent, role: { title: string; levels: string[] }, marketKeywords: string[], country = "US"): Promise<{ content: ResumeContent; notes: string[]; ai: boolean }> {
  if (aiConfigured()) {
    const out = await claude(
      `You are a senior recruiter turned executive resume writer. You have screened tens of thousands of resumes for ${role.title} roles at top companies and know exactly what earns an interview.
Rewrite the candidate's master resume into a resume targeted at ${role.title} roles (${role.levels.join("/")} level) in ${country}.
${TRUTH}
${RESUME_CRAFT}
Use these keywords from live ${role.title} job postings ONLY where the resume genuinely supports them: ${marketKeywords.join(", ")}.
Also return "notes": up to 5 short, specific suggestions where the candidate could strengthen the resume with facts only they know (e.g. "Add the size of the budget you managed at Kaar Tech"). Never put these suggestions inside the resume.
Return ONLY JSON: {"resume": ${SCHEMA}, "notes": string[]}`,
      [{ role: "user", content: `MASTER RESUME JSON:\n${JSON.stringify(master)}` }],
      6000,
      { model: "writer", temperature: 0.3 },
    );
    const j = extractJson<{ resume: ResumeContent; notes?: string[] }>(out);
    if (j?.resume?.experience?.length) return { content: guard(master, j.resume), notes: (j.notes || []).slice(0, 5), ai: true };
  }
  return { content: ruleRoleResume(master, role.title, marketKeywords), notes: ruleNotes(master), ai: false };
}

/* ------------------------------------------------------------------ */
/* Job-specific resume + cover letter                                  */
/* ------------------------------------------------------------------ */

export type TailorResult = {
  resume: ResumeContent;
  coverLetter: string;
  keywords: string[];
  ai: boolean;
  tone: LetterTone;
  analysis: { requirement: string; evidence: string | null }[];
  letterIssues: string[];
};

type JobIn = { title: string; company: string; description: string | null; country: string; location?: string | null };

export async function tailorForJob(base: ResumeContent, job: JobIn, candidateName: string, tone: LetterTone = "confident"): Promise<TailorResult> {
  const keywords = extractKeywords(`${job.title} ${job.title} ${job.description || ""}`, 22);
  const name = base.name || candidateName;
  if (aiConfigured()) {
    const out = await claude(
      `You are an elite recruiter and resume writer. Tailor this candidate's resume to ONE specific job so it passes ATS screening and makes the hiring manager want to call — then write the cover letter.
${TRUTH}
${RESUME_CRAFT}
STEP 1 — Analyse the job: list its 6–8 most important requirements. For each, quote the strongest supporting evidence from the resume, or null if none.
STEP 2 — Tailor the resume: mirror the job's exact wording for skills and responsibilities the resume genuinely shows; move the most relevant bullets to the top of each role; sharpen the headline and summary for this job. Keep it to one page for under 8 years of experience.
STEP 3 — Write the cover letter (${tone}: ${LETTER_TONES[tone].guide})
- 220–320 words, 4 short paragraphs. Greeting: "Dear ${job.company} Hiring Team,".
- P1 (2–3 sentences): name the role; one specific, non-generic reason this company/role (use a concrete detail from the posting: product, problem, customer, mission) and the candidate's headline credential.
- P2: the 2 strongest proof points mapped to the job's top requirements, told as mini-stories with the real numbers.
- P3: what they would bring/do in this role, tied to 1–2 responsibilities in the posting. Optionally one line on a transferable strength.
- P4 (1–2 sentences): confident close and invitation to talk. No begging, no "I hope".
- Sign off "Sincerely," then "${name}" on the next line (for "warm" tone use "Best regards,").
- Write like a sharp human professional: varied sentence length, plain words, no clichés, no exclamation marks, at most one dash in the whole letter, never start more than two sentences with "I". Never mention AI, tools, visas or salary. ${job.country === "US" ? "US spelling." : "UK/Commonwealth spelling."}
- Banned phrases: ${BANNED.slice(0, 26).join("; ")}.
Return ONLY JSON: {"analysis":[{"requirement":string,"evidence":string|null}],"resume": ${SCHEMA},"coverLetter":string}`,
      [
        {
          role: "user",
          content: `JOB: ${job.title} at ${job.company} (${job.location || job.country})\n${(job.description || "").slice(0, 9000)}\n\nATS KEYWORDS SEEN IN THE POSTING (use only if supported): ${keywords.join(", ")}\n\nCANDIDATE RESUME JSON:\n${JSON.stringify(base)}`,
        },
      ],
      7000,
      { model: "tailor", temperature: 0.4 },
    );
    const j = extractJson<{ analysis?: TailorResult["analysis"]; resume: ResumeContent; coverLetter: string }>(out);
    if (j?.resume?.experience?.length && j.coverLetter) {
      let letter = tidyLetter(j.coverLetter);
      let issues = lintLetter(letter, job.company);
      if (issues.length) {
        const fixed = await claude(
          `You are a meticulous editor. Fix ONLY these problems in the cover letter and return the full corrected letter as plain text, nothing else. Keep every fact. Problems: ${issues.join("; ")}.`,
          [{ role: "user", content: letter }],
          1500,
          { model: "writer", temperature: 0.2 },
        );
        if (fixed && lintLetter(tidyLetter(fixed), job.company).length < issues.length) {
          letter = tidyLetter(fixed);
          issues = lintLetter(letter, job.company);
        }
      }
      return { resume: guard(base, j.resume), coverLetter: letter, keywords, ai: true, tone, analysis: (j.analysis || []).slice(0, 8), letterIssues: issues };
    }
  }
  const resume = ruleRoleResume(base, job.title, keywords);
  const letter = ruleLetter(resume, job, keywords, tone);
  return { resume, coverLetter: letter, keywords, ai: false, tone, analysis: [], letterIssues: lintLetter(letter, job.company) };
}

/* ------------------------------------------------------------------ */
/* Quality checks                                                      */
/* ------------------------------------------------------------------ */

export function lintLetter(text: string, company: string): string[] {
  const t = text.toLowerCase();
  const issues: string[] = [];
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 170) issues.push(`too short (${words} words, aim for 220–320)`);
  if (words > 380) issues.push(`too long (${words} words, aim for 220–320)`);
  for (const b of BANNED) if (t.includes(b)) issues.push(`remove the cliché "${b}"`);
  if (/\[[^\]]{2,40}\]|\{[^}]{2,40}\}|<[^>]{2,40}>/.test(text)) issues.push("remove placeholder brackets");
  if (/[—–-]\s*[.,;]/.test(text) || /\s[,.;]/.test(text)) issues.push("fix broken punctuation");
  if ((text.match(/—/g) || []).length > 1) issues.push("use at most one em dash");
  if (/!/.test(text)) issues.push("remove exclamation marks");
  const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.length > 3);
  const iStarts = sentences.filter((s) => /^I\b/.test(s.trim())).length;
  if (sentences.length && iStarts / sentences.length > 0.35) issues.push("too many sentences start with “I”; vary the openings");
  if (company && !t.includes(company.toLowerCase().split(/[ ,]/)[0])) issues.push(`mention ${company} by name`);
  if (/\b(ai|chatgpt|claude|language model|vantage)\b/i.test(text)) issues.push("remove any mention of tools or AI");
  return issues;
}

function tidyLetter(s: string) {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

function norm(s: string) {
  return ` ${s.toLowerCase().replace(/[^a-z0-9%$+#.& ]/g, " ").replace(/\s+/g, " ")} `;
}
function coverage(sentence: string, src: string) {
  const toks = norm(sentence).trim().split(" ").filter((w) => w.length > 2);
  if (!toks.length) return 1;
  return toks.filter((w) => src.includes(` ${w} `)).length / toks.length;
}

/** Keep the AI's rewrite honest: same jobs and dates, no invented skills or numbers. */
function guard(original: ResumeContent, out: ResumeContent): ResumeContent {
  const src = norm(resumeText(original));
  const numbers = new Set((resumeText(original).match(/\d[\d,.]*%?\+?/g) || []).map((n) => n.replace(/[,+]/g, "")));
  const r = clean(out);
  r.name = original.name || r.name;
  r.email = original.email;
  r.phone = original.phone;
  r.links = original.links;
  r.location = original.location || r.location;
  // Skills must exist in the original.
  r.skills = (r.skills || []).map((g) => ({ ...g, items: g.items.filter((i) => src.includes(norm(i))) })).filter((g) => g.items.length);
  // Jobs and dates must match the original; bullets must not introduce new numbers.
  const byKey = new Map((original.experience || []).map((e) => [`${norm(e.company)}|${(e.start || "").toLowerCase()}`, e]));
  r.experience = (r.experience || []).map((e) => {
    const o = byKey.get(`${norm(e.company)}|${(e.start || "").toLowerCase()}`) || (original.experience || []).find((x) => norm(x.company) === norm(e.company) && norm(x.title) === norm(e.title));
    const bullets = e.bullets.filter((b) => (b.match(/\d[\d,.]*%?\+?/g) || []).every((n) => numbers.has(n.replace(/[,+]/g, ""))));
    return o ? { ...e, title: o.title, company: o.company, start: o.start, end: o.end, location: o.location, bullets: bullets.length ? bullets : o.bullets } : null;
  }).filter((e): e is NonNullable<typeof e> => Boolean(e));
  // Never drop a job: append any the model removed, as-is.
  for (const o of original.experience || []) {
    if (!r.experience.some((e) => norm(e.company) === norm(o.company) && e.start === o.start)) r.experience.push(o);
  }
  r.education = original.education;
  r.certifications = (r.certifications || []).filter((c) => (original.certifications || []).some((o) => norm(o).includes(norm(c).trim().split(" ").slice(0, 2).join(" "))));
  if (!r.certifications.length) r.certifications = original.certifications;
  r.awards = original.awards;
  if (r.summary && (r.summary.match(/\d[\d,.]*%?\+?/g) || []).some((n) => !numbers.has(n.replace(/[,+]/g, "")) && !/^\d{1,2}$/.test(n))) r.summary = original.summary;
  return r;
}

function clean(c: ResumeContent): ResumeContent {
  const s = (x?: string) => (x || "").replace(/\s+/g, " ").trim();
  return {
    ...c,
    name: s(c.name),
    headline: s(c.headline) || undefined,
    summary: s(c.summary) || undefined,
    skills: (c.skills || []).map((g) => ({ group: s(g.group) || "Skills", items: (g.items || []).map(s).filter(Boolean) })).filter((g) => g.items.length),
    experience: (c.experience || []).map((e) => ({ ...e, title: s(e.title), company: s(e.company), bullets: (e.bullets || []).map(s).filter((b) => b.length > 2) })),
    projects: (c.projects || []).map((p) => ({ ...p, bullets: (p.bullets || []).map(s).filter(Boolean) })),
    education: (c.education || []).map((e) => ({ ...e, degree: s(e.degree), school: s(e.school) })),
    certifications: (c.certifications || []).map(s).filter(Boolean),
    awards: (c.awards || []).map(s).filter(Boolean),
    additional: (c.additional || []).map(s).filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* Rule-based fallbacks (no AI key): conservative and grammatical      */
/* ------------------------------------------------------------------ */

function ruleRoleResume(base: ResumeContent, target: string, keywords: string[]): ResumeContent {
  const kw = keywords.map((k) => k.toLowerCase());
  const targetWords = target.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hits = (s: string) => kw.filter((k) => s.toLowerCase().includes(k)).length * 2 + targetWords.filter((w) => s.toLowerCase().includes(w)).length;
  const r: ResumeContent = JSON.parse(JSON.stringify(base));
  r.skills = (r.skills || []).map((g) => ({ ...g, items: [...g.items].sort((a, b) => hits(b) - hits(a)) })).sort((a, b) => hits(b.items.join(" ")) - hits(a.items.join(" ")));
  r.experience = (r.experience || []).map((e) => ({
    ...e,
    bullets: [...e.bullets].map(polishBullet).sort((a, b) => hits(b) - hits(a) || Number(/\d/.test(b)) - Number(/\d/.test(a))),
  }));
  if (!r.headline || !r.headline.toLowerCase().includes(targetWords[0] || "")) {
    const strengths = (r.skills || []).flatMap((g) => g.items).slice(0, 3);
    r.headline = [titleCase(target), ...strengths].join(" | ");
  }
  return r;
}

function polishBullet(b: string) {
  let t = b.trim().replace(/\s+/g, " ").replace(/\s*[—–-]\s*$/, "");
  t = t.replace(/^(responsible for|duties included|tasked with)\s+/i, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function ruleNotes(c: ResumeContent): string[] {
  const notes: string[] = [];
  for (const e of c.experience || []) {
    const unquantified = e.bullets.filter((b) => !/\d/.test(b)).length;
    if (unquantified >= 2) notes.push(`Add a number to a ${e.company || e.title} bullet (volume, %, budget, time saved).`);
  }
  if (!c.summary) notes.push("Add a 2–3 line summary with your years of experience and one signature result.");
  return notes.slice(0, 5);
}

function sentenceFromBullet(b: string) {
  const t = polishBullet(b);
  return t.length > 230 ? `${t.slice(0, t.lastIndexOf(" ", 220))}.` : t;
}

function ruleLetter(r: ResumeContent, job: JobIn, keywords: string[], tone: LetterTone): string {
  const latest = (r.experience || [])[0];
  const matched = scoreResume(r, keywords).matched.slice(0, 3);
  const proofs = (r.experience || []).flatMap((e) => e.bullets.map((b) => ({ b, e }))).filter((x) => /\d/.test(x.b)).slice(0, 2);
  const years = yearsOf(r);
  const role = latest ? `${latest.title}${latest.company ? ` at ${latest.company}` : ""}` : "";
  const p1 = `I'm applying for the ${job.title} role at ${job.company}. ${
    years ? `I bring ${years} year${years > 1 ? "s" : ""} of experience` : "I bring hands-on experience"
  }${matched.length ? ` in ${listJoin(matched)}` : ""}${role ? `, most recently as ${role}` : ""}.`;
  const p2 = proofs.length
    ? `Two results that are relevant to this role:\n${proofs.map((x) => `• ${sentenceFromBullet(x.b)}`).join("\n")}`
    : latest?.bullets?.[0]
      ? `In my most recent role, one highlight: ${sentenceFromBullet(latest.bullets[0]).replace(/^./, (c) => c.toLowerCase())}`
      : "";
  const p3 = `What I would bring to ${job.company} is the same approach: clear goals, careful measurement and steady improvement week over week.`;
  const p4 = tone === "formal" ? "I would welcome the opportunity to discuss how I can contribute to your team. Thank you for your consideration." : "I'd welcome the chance to talk about how I can contribute to your team. Thank you for your time.";
  const sign = tone === "warm" ? "Best regards," : "Sincerely,";
  return [`Dear ${job.company} Hiring Team,`, p1, p2, p3, p4, `${sign}\n${r.name || ""}`].filter(Boolean).join("\n\n");
}

function listJoin(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function yearsOf(r: ResumeContent): number {
  const ys = (r.experience || []).flatMap((e) => [e.start, e.end]).map((d) => (d && /present/i.test(d) ? new Date().getFullYear() : parseInt((d || "").match(/\d{4}/)?.[0] || "", 10))).filter((n) => !isNaN(n));
  if (!ys.length) return 0;
  return Math.max(0, Math.max(...ys) - Math.min(...ys));
}
