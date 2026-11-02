import "server-only";
import { claude, extractJson } from "@/lib/ai";
import { resumeText } from "@/lib/ats";
import { HARVARD_PROMPT } from "@/lib/resume/harvard";
import { playbookFor, playbookPrompt, type CompanyKind, type Playbook } from "@/lib/resume/playbooks";
import { polishResume } from "@/lib/resume/polish";
import { repairResume } from "@/lib/resume/repair";
import { BANNED, SCHEMA, TRUTH, formatPrompt, guard, lintLetter, tidyLetter } from "@/lib/resume/rules";
import { LETTER_TONES } from "@/lib/resume/styles";
import type { CountryFormat } from "@/lib/resume/country";
import type { LetterTone, ResumeContent } from "@/lib/types";

/**
 * Resume studio: the way an elite recruiter + hiring manager would rewrite a resume for one job.
 *   1. Plan     read the posting and the company, then decide how to present this person honestly
 *   2. Write    rewrite every section to that plan (X-Y-Z bullets, posting language, real numbers only)
 *   3. Review   the hiring manager's 30-second read: score it, then fix every weakness found
 *   4. Letter   written in parallel from the same plan, then edited against our cliché checks
 * Every AI step is followed by the truth guard (no invented employers, dates, tools or numbers) and a deterministic
 * polish (order, honest headline, de-duplicated skills, no clichés).
 */

export type JobBrief = {
  level: string;
  family: string;
  companyKind: CompanyKind;
  mustHave: { requirement: string; phrases: string[] }[];
  niceToHave: string[];
  problems: string[];
  hook: string;
  phrases: string[];
  /** Hard requirements that screen people out before a human reads anything (authorization, degree, years, location, licence). */
  knockouts: { requirement: string; status: "met" | "unclear" | "not met"; note: string }[];
};

export type Strategy = {
  identity: string;
  headline: string;
  angle: string;
  pillars: { theme: string; proof: string }[];
  lead: string[];
  compress: string[];
  requirements: { requirement: string; evidence: string | null; show?: string }[];
  gaps: { requirement: string; bridge: string }[];
  /** Questions only the candidate can answer that would add a real number or proof. Never written into the resume. */
  questions: string[];
  keywords: string[];
};

export type Review = {
  /** 0–100, the hiring manager's read of the final version. */
  score: number;
  scores: Record<"first_impression" | "relevance" | "impact" | "clarity" | "credibility" | "ats", number>;
  strengths: string[];
  /** What the review pass changed. */
  fixes: string[];
  /** What a recruiter may still question (honest gaps). */
  risks: string[];
};

export type StudioJob = { title: string; company: string; description: string | null; country: string; location?: string | null };

export type StudioResult = {
  resume: ResumeContent;
  coverLetter: string | null;
  letterIssues: string[];
  brief: JobBrief | null;
  strategy: Strategy;
  review: Review | null;
  playbook: Pick<Playbook, "name" | "kind" | "values">;
  stages: string[];
};

const CRAFT = `WRITING STANDARD (what Google, Meta, Amazon and Fortune 500 hiring managers reward)
- Bullets use Google's X-Y-Z shape whenever the facts allow: "Accomplished [X] as measured by [Y], by doing [Z]". Lead with the outcome or the scope, then how. If no outcome number exists, quantify scope with numbers already in the resume (accounts, sources, releases, students, specs) or state the concrete business result in words.
- Strong, specific verbs; present tense for the current role, past tense otherwise. Never repeat an opening verb within a role, at most twice in the whole resume.
- Banned words (recruiters read them as filler or AI): spearheaded, utilized, utilizing, leveraged, orchestrated, fostered, transformative, synergy, surge, skyrocketed, robust, seamless, cutting-edge, world-class, best-in-class, dynamic, passionate, results-driven, detail-oriented, team player, responsible for, helped, worked on, successfully, various, delve.
- 16–32 words per bullet, one idea each. Tools go at the end ("…using SQL and Power BI") only when they matter for this job.
- Never use the same number in two bullets. Never start two bullets in a row with the same structure.
- The posting's exact phrases (from the plan) appear naturally where the evidence is real; no keyword lists stuffed into bullets.
- Summary: 2–3 lines, no pronouns. The professional identity + years (use the resume's own figure, e.g. "5+ years"), 1–2 signature results with real numbers, and the angle for this role. No "seeking", no location, no objective statement.
- Headline: "<identity> | <specialism> | <specialism>" — the identity is who the person truly is; never the target job title unless they have held it.
- Skills: 3–4 groups named for this job's world (e.g. "Analytics & BI", "Product Delivery", "Marketing Technology"), each 5–10 items, most relevant first, the posting's names for tools the person really uses. No soft skills, no certifications repeated as skills, no duplicates.
- Every role keeps its title, employer and dates exactly. Roles marked "brief" stay one line with no bullets. Lead roles get 4–5 bullets, other recent roles 2–4, compressed roles 1–2. A role with only one source bullet may be split into two bullets only by separating facts already in it, never by adding new ones.
- Each bullet uses only facts from its own role. Never move a detail from one role to another, and never add frequencies (daily, weekly), audiences, scale words (enterprise, global, cross-functional), adjectives or results that the source does not state for that role.
- Keep the strength of every claim: where the source says "contributed to", "supported" or "helped", the rewrite keeps shared credit (e.g. "Contributed to a 35% increase in qualified pipeline by …"). Never upgrade it to "drove", "led", "delivered" or "grew". Likewise "mentored" never becomes "supervised" or "managed", and "supported" never becomes "owned".
- The posting's vocabulary may only rename what the source already describes. Never swap one metric for another (cost per lead is not customer acquisition cost; impressions are not traffic), and never add objects the source does not mention (budgets, models, frameworks, roadmaps, revenue, teams).
- A promotion inside one employer is a strong signal: keep it visible.
- Awards, a team the person led or mentored, funding rounds or acquisitions they supported, and things they built are high-value proof: surface them when relevant to the job.
- Projects are products the person designed and built: keep EVERY project from the source with its name and stack, ordered by relevance to this job; 2–3 bullets for relevant ones, at least 1 for the rest. They are major proof of initiative and technical depth.
- Recruiters read job titles first: never change a title, and write bullets so the first one in each role is the most relevant to this job.
- Founders and independent ventures: keep the "Founder" title, but write those bullets in the target function's language (owned the roadmap, defined metrics, ran experiments, shipped releases) so a corporate hiring manager sees the job they are hiring for, not an entrepreneur who might leave.
- Employers, schools and certifications are spelled out in full; no unexplained abbreviations.
- One page for under ~10 years of experience.`;

const json = (x: unknown) => JSON.stringify(x);

function identityFrom(c: ResumeContent): string {
  const h = (c.headline || "").split(/\s+\|\s+/)[0]?.trim();
  if (h && h.length <= 48) return h;
  const t = (c.experience || []).find((e) => !e.brief && e.title)?.title || "";
  return t.replace(/\(.*?\)/g, "").trim();
}

function blankStrategy(c: ResumeContent, keywords: string[]): Strategy {
  const identity = identityFrom(c);
  return { identity, headline: c.headline || identity, angle: "", pillars: [], lead: [], compress: [], requirements: [], gaps: [], questions: [], keywords };
}

/* ------------------------------------------------------------------ */
/* 1. Plan                                                             */
/* ------------------------------------------------------------------ */

async function plan(c: ResumeContent, job: StudioJob, pb: Playbook, keywords: string[]): Promise<{ brief: JobBrief | null; strategy: Strategy }> {
  const out = await claude(
    `You are two people at once: the hiring manager for this ${job.title} role at ${job.company}, and the executive recruiter who places candidates at Google, Meta, Amazon and Fortune 500 companies.
First read the posting like the hiring manager. Then decide how to present THIS candidate so they get the interview, using only what is true.
${TRUTH}
${playbookPrompt(pb)}
Return ONLY JSON:
{"job":{"level":"entry|mid|senior|lead|executive","family":string,"companyKind":"bigtech|enterprise|consulting|finance|startup|public|agency|other",
  "mustHave":[{"requirement":string,"phrases":[exact phrases as written in the posting]}] (5-8),
  "niceToHave":[string] (0-5),"problems":[the 2-3 business problems this hire is meant to solve],
  "hook":"one concrete, specific detail from the posting or company worth referencing in a cover letter (product, customer, mission, initiative)",
  "phrases":[15-25 exact ATS phrases from the posting: tools, methods, domain terms, responsibility phrases],
  "knockouts":[{"requirement":"a hard screening requirement stated in the posting (minimum degree, years, work authorization, location/on-site, licence, clearance)","status":"met|unclear|not met","note":"short, based only on the resume"}] (0-5)},
 "strategy":{"identity":"who this person truly is professionally, 2-5 words (e.g. 'Business & Data Analyst', 'Growth Marketing Analyst'). Supported by titles or work they actually held. NOT the target title unless they held it.",
  "headline":"identity | 2 proven specialisms most relevant to this job",
  "angle":"one sentence: why this candidate is a strong hire for this role, using their real evidence",
  "pillars":[{"theme":string,"proof":"a fact from the resume"}] (3),
  "lead":["Title @ Company" of the 1-3 roles to expand],"compress":["Title @ Company" of roles to cut to 1-2 bullets],
  "requirements":[{"requirement":string,"evidence":"near-verbatim quote from the resume or null","show":"how the resume should show it"}] (one per must-have),
  "gaps":[{"requirement":string,"bridge":"the closest true fact, or 'leave out'"}],
  "questions":[3 to 5 short questions (always at least 3) to ask the candidate that would unlock a missing number or proof for THIS job, each naming the role, e.g. 'At Kaar Tech, about how many hours a week did the automated reports save?'],
  "keywords":[the posting phrases this resume legitimately supports]}}`,
    [{ role: "user", content: `JOB: ${job.title} at ${job.company} (${job.location || job.country})\n${(job.description || "").slice(0, 9000)}\n\nKEYWORDS SEEN IN THE POSTING: ${keywords.join(", ")}\n\nCANDIDATE RESUME JSON:\n${json(c)}` }],
    6000,
    { model: "writer", temperature: 0.2, feature: "tailor-plan" },
  );
  const j = extractJson<{ job?: JobBrief; strategy?: Partial<Strategy> }>(out);
  const base = blankStrategy(c, keywords);
  if (!j?.strategy) return { brief: j?.job || null, strategy: base };
  const s = j.strategy;
  const arr = <T,>(x: unknown, n: number): T[] => (Array.isArray(x) ? (x as T[]).slice(0, n) : []);
  return {
    brief: j.job || null,
    strategy: {
      identity: (s.identity || base.identity).slice(0, 60),
      headline: s.headline || base.headline,
      angle: s.angle || "",
      pillars: arr(s.pillars, 3),
      lead: arr(s.lead, 3),
      compress: arr(s.compress, 6),
      requirements: arr(s.requirements, 8),
      gaps: arr(s.gaps, 6),
      questions: arr<unknown>(s.questions, 5).map((q) => (typeof q === "string" ? q : (q as { question?: string; text?: string })?.question || (q as { text?: string })?.text || "")).filter((q) => q.length > 10),
      keywords: arr<string>(s.keywords, 25).length ? arr<string>(s.keywords, 25) : keywords,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2. Write                                                            */
/* ------------------------------------------------------------------ */

async function write(c: ResumeContent, job: StudioJob, pb: Playbook, fmt: CountryFormat, brief: JobBrief | null, st: Strategy, onePage: boolean): Promise<ResumeContent | null> {
  const out = await claude(
    `You are an elite resume writer who has placed candidates at Google, Meta, Amazon and Fortune 500 companies. Rewrite this candidate's resume for ONE job, following the plan exactly.
${TRUTH}
${CRAFT}
${HARVARD_PROMPT}
${formatPrompt(fmt, c)}
${playbookPrompt(pb)}
Length: ${onePage ? "one page" : "two pages at most"}.
Return ONLY JSON matching: ${SCHEMA}
(experience items may also carry "url" and "brief" exactly as given; copy them unchanged.)`,
    [{
      role: "user",
      content: `JOB: ${job.title} at ${job.company}\nWHAT THE JOB NEEDS: ${json(brief ? { mustHave: brief.mustHave, problems: brief.problems, phrases: brief.phrases } : { phrases: st.keywords })}\n\nPLAN: ${json({ identity: st.identity, headline: st.headline, angle: st.angle, pillars: st.pillars, lead: st.lead, compress: st.compress, requirements: st.requirements, keywords: st.keywords })}\n\nCANDIDATE RESUME JSON (the only source of facts):\n${json(c)}`,
    }],
    8000,
    { model: "tailor", temperature: 0.35, feature: "tailor-write" },
  );
  const j = extractJson<ResumeContent | { resume: ResumeContent }>(out);
  const r = j && ("resume" in j ? j.resume : j);
  return r?.experience?.length ? r : null;
}

/* ------------------------------------------------------------------ */
/* 3. Hiring-manager review                                            */
/* ------------------------------------------------------------------ */

async function review(draft: ResumeContent, original: ResumeContent, job: StudioJob, pb: Playbook, st: Strategy): Promise<{ review: Review; resume: ResumeContent | null } | null> {
  const out = await claude(
    `You are the hiring manager for ${job.title} at ${job.company}, reviewing with a senior recruiter. You give each resume 30 seconds, then decide who gets a call.
Read the DRAFT the way you really would: headline and current title first, then the top bullet of each role, then skills.
FACT CHECK FIRST: compare every bullet, the headline and the summary with the ORIGINAL, phrase by phrase. Any detail not stated in the ORIGINAL for that same role — a different metric (e.g. "customer acquisition cost" where it says "cost per lead"), an added object (budget reallocation, analytical models, KPI frameworks, revenue), an added frequency, scale or audience, or stronger credit than the ORIGINAL gives — is a fabrication: rewrite it with the ORIGINAL's facts. A hiring manager will ask about every line in the interview.
Then find every weakness: vague or duty-style bullets, outcomes buried at the end, duplicated metrics, weak or repeated verbs, buzzwords, irrelevant bullets ranked high, missing exact posting phrases where the ORIGINAL proves the skill, a headline or summary that is generic or overclaims, skills that are padded, anything that reads like AI.
Then FIX every one of them yourself in a revised resume, under the same rules:
${TRUTH}
${CRAFT}
${playbookPrompt(pb)}
Score the REVISED version honestly (do not inflate; 70 = would interview, 85 = strong yes, 95 = rare).
Return ONLY JSON: {"review":{"score":0-100,"scores":{"first_impression":1-10,"relevance":1-10,"impact":1-10,"clarity":1-10,"credibility":1-10,"ats":1-10},"strengths":[3 short],"fixes":[up to 8 short descriptions of what you changed, fact-check corrections first],"risks":[up to 3 things a recruiter may still question]},"resume": ${SCHEMA}}`,
    [{ role: "user", content: `JOB POSTING:\n${(job.description || "").slice(0, 7000)}\n\nPOSITIONING PLAN: ${json({ identity: st.identity, angle: st.angle, keywords: st.keywords })}\n\nORIGINAL RESUME (the only source of facts):\n${json(original)}\n\nDRAFT TO REVIEW:\n${json(draft)}` }],
    9000,
    { model: "writer", temperature: 0.2, feature: "tailor-review" },
  );
  const j = extractJson<{ review?: Partial<Review>; resume?: ResumeContent }>(out);
  if (!j?.review) return null;
  const n = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  const sc = (j.review.scores || {}) as Partial<Review["scores"]>;
  return {
    review: {
      score: n(j.review.score, 0, 100, 0),
      scores: {
        first_impression: n(sc.first_impression, 1, 10, 0), relevance: n(sc.relevance, 1, 10, 0), impact: n(sc.impact, 1, 10, 0),
        clarity: n(sc.clarity, 1, 10, 0), credibility: n(sc.credibility, 1, 10, 0), ats: n(sc.ats, 1, 10, 0),
      },
      strengths: (j.review.strengths || []).slice(0, 3),
      fixes: (j.review.fixes || []).slice(0, 8),
      risks: (j.review.risks || []).slice(0, 3),
    },
    resume: j.resume?.experience?.length ? j.resume : null,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Cover letter                                                     */
/* ------------------------------------------------------------------ */

async function letter(r: ResumeContent, original: ResumeContent, job: StudioJob, pb: Playbook, fmt: CountryFormat, brief: JobBrief | null, st: Strategy, tone: LetterTone): Promise<{ text: string; issues: string[] } | null> {
  const name = r.name || "";
  const out = await claude(
    `You write cover letters that hiring managers at ${pb.name} actually finish reading. Write one for ${job.title} at ${job.company}.
${TRUTH}
${playbookPrompt(pb)}
Tone: ${tone} — ${LETTER_TONES[tone].guide}
STRUCTURE (230–320 words, 4 short paragraphs):
- Greeting: "Dear ${job.company} Hiring Team,".
- P1 (2–3 sentences): open with the specific hook (a real detail of the role, product or company) and connect it to the candidate's identity and strongest credential. Name the role. Never open with "I am writing", "I am excited" or the candidate's name.
- P2: the two pillars as short proof stories with real numbers, each tied to one of the job's must-haves or problems.
- P3: what they would do in the first months, tied to 1–2 responsibilities in the posting; if there is an honest gap worth naming (career move, new domain), bridge it in one sentence with the closest true fact.
- P4 (1–2 sentences): confident close, invitation to talk. No "I hope", no begging.
- Sign off "${tone === "warm" ? "Best regards," : "Sincerely,"}" then "${name}".
FACTS: every claim about the past must be in the ORIGINAL resume below, with the same metric and the same credit ("contributed to" stays "contributed to"). The posting's terms (e.g. data marts, telemetry, consumption) may describe what the candidate WILL do, never what they did, unless the ORIGINAL says it.
VOICE: first person, like a confident professional writing to one hiring manager. Plain verbs ("I built", "I led"), varied openings so no more than a third of sentences start with "I". Never narrate the letter's structure ("two pillars", "three reasons", "this background connects"). No exclamation marks, at most one dash. Never mention AI, tools used to write, visas or salary. ${fmt.spelling === "us" ? "US spelling." : fmt.spellingNote || "UK/Commonwealth spelling."}
Banned phrases: ${BANNED.join("; ")}; let us schedule; robust; I am confident; pillars; underpin; telemetry.
Return ONLY the letter as plain text.`,
    [{ role: "user", content: `HOOK: ${brief?.hook || "(pick one concrete detail from the posting)"}\nMUST-HAVES: ${json(brief?.mustHave?.map((m) => m.requirement) || [])}\nPROBLEMS: ${json(brief?.problems || [])}\nPLAN: ${json({ identity: st.identity, angle: st.angle, pillars: st.pillars, gaps: st.gaps })}\n\nPOSTING:\n${(job.description || "").slice(0, 6000)}\n\nTAILORED RESUME (for emphasis only):\n${json({ headline: r.headline, summary: r.summary })}\n\nORIGINAL RESUME (the only source of facts):\n${json(original)}` }],
    2500,
    { model: "writer", temperature: 0.5, feature: "tailor-letter" },
  );
  if (!out || out.trim().length < 400) return null;
  let text = tidyLetter(out.replace(/^```\w*\n?|```$/g, ""));
  // Fact-check: every past claim in the right role, with the same metric, credit and years figure as the resume.
  const years = (original.summary || "").match(/\b(\d{1,2}\+?)\s+years\b/i)?.[1];
  const checked = await claude(
    `You are a fact-checker for a cover letter. Compare every claim about the candidate's past with the ORIGINAL resume.
Fix ONLY these problems, changing as few words as possible: a fact attributed to the wrong employer or role; a metric, tool, number or result that differs from the ORIGINAL; stronger credit than the ORIGINAL gives ("contributed to" must stay); anything the ORIGINAL does not state.${years ? ` Years of experience must read "${years}" (as in the resume), never another number.` : ""}
Keep the tone, structure, greeting and sign-off. Return ONLY the full corrected letter as plain text.`,
    [{ role: "user", content: `ORIGINAL RESUME:\n${json(original)}\n\nLETTER:\n${text}` }],
    2500,
    { model: "writer", temperature: 0.1, feature: "tailor-letter-check" },
  ).catch(() => null);
  if (checked && checked.trim().length > text.length * 0.7 && /Dear /.test(checked)) text = tidyLetter(checked.replace(/^```\w*\n?|```$/g, ""));
  let issues = lintLetter(text, job.company);
  if (issues.length) {
    const fixed = await claude(
      `You are a meticulous editor. Fix ONLY these problems in the cover letter and return the full corrected letter as plain text, nothing else. Keep every fact. Problems: ${issues.join("; ")}.`,
      [{ role: "user", content: text }],
      2000,
      { model: "writer", temperature: 0.2, feature: "tailor-fix" },
    );
    if (fixed && lintLetter(tidyLetter(fixed), job.company).length < issues.length) {
      text = tidyLetter(fixed);
      issues = lintLetter(text, job.company);
    }
  }
  return { text, issues };
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

export async function studio(base0: ResumeContent, job: StudioJob, opts: { fmt: CountryFormat; onePage: boolean; tone: LetterTone; keywords: string[]; withLetter?: boolean }): Promise<StudioResult | null> {
  const base = repairResume(base0);
  const stages: string[] = [];
  let pb = playbookFor(job.company);
  const { brief, strategy } = await plan(base, job, pb, opts.keywords);
  stages.push(brief ? "plan" : "plan-skipped");
  if (strategy.questions.length < 3) strategy.questions = [...strategy.questions, ...numberQuestions(base)].slice(0, 5);
  if (brief?.companyKind && pb.kind === "other") pb = playbookFor(job.company, brief.companyKind);

  const jobText = `${job.title} ${job.description || ""}`;
  const finish = (r: ResumeContent) => {
    const out = polishResume(guard(base, r, jobText), { jobTitle: job.title, identity: strategy.identity, original: base });
    // A headline needs its specialisms: if the checks stripped them, borrow the person's own from the master headline.
    const segs = (out.headline || "").split(" | ").filter(Boolean);
    if (segs.length < 2) {
      const own = (base.headline || "").split(/\s+\|\s+/).slice(1).filter((x) => !segs.includes(x));
      out.headline = [segs[0] || strategy.identity, ...own].filter(Boolean).slice(0, 3).join(" | ");
    }
    return out;
  };

  const drafted = await write(base, job, pb, opts.fmt, brief, strategy, opts.onePage);
  if (!drafted) return null;
  const draft = finish(drafted);
  stages.push("write");

  // The review and the letter don't depend on each other: run them together.
  const [rv, lt] = await Promise.all([
    review(draft, base, job, pb, strategy),
    opts.withLetter === false ? Promise.resolve(null) : letter(draft, base, job, pb, opts.fmt, brief, strategy, opts.tone),
  ]);
  let resume = draft;
  if (rv?.resume) {
    const revised = finish(rv.resume);
    // Accept the revision only if it kept every role and didn't lose content.
    const bullets = (x: ResumeContent) => (x.experience || []).reduce((n, e) => n + (e.bullets || []).length, 0);
    if ((revised.experience || []).length === (draft.experience || []).length && bullets(revised) >= Math.min(bullets(draft), 8)) {
      resume = revised;
      stages.push("review");
    } else stages.push("review-rejected");
  } else stages.push(rv ? "review-scored" : "review-skipped");
  if (lt) stages.push("letter");

  return {
    resume,
    coverLetter: lt?.text || null,
    letterIssues: lt?.issues || [],
    brief,
    strategy,
    review: rv?.review || null,
    playbook: { name: pb.name, kind: pb.kind, values: pb.values },
    stages,
  };
}

/** Questions that would add a real number to roles whose bullets have none (never written into the resume). */
export function numberQuestions(c: ResumeContent): string[] {
  const out: string[] = [];
  for (const e of (c.experience || []).filter((x) => !x.brief)) {
    const plain = (e.bullets || []).filter((b) => !/\d/.test(b));
    if (!plain.length) continue;
    const b = plain[0].replace(/\.$/, "");
    const at = e.company ? `At ${e.company.split(",")[0]}` : `As ${e.title}`;
    if (/website|site|content|video|social|outreach|engagement/i.test(b)) out.push(`${at}, what was the reach or engagement change (visitors, followers, views, sign-ups) from this work?`);
    else if (/report|dashboard/i.test(b)) out.push(`${at}, how many hours a week did the reporting or dashboards save, or how many people used them?`);
    else if (/campaign|paid|ads|media/i.test(b)) out.push(`${at}, what budget did you manage, and what changed in cost per lead or conversions?`);
    else out.push(`${at}, can you put a number on "${b.slice(0, 70)}${b.length > 70 ? "…" : ""}" (people, time saved, revenue, or %)?`);
    if (out.length >= 4) break;
  }
  return out;
}

/** Text the truth guard and match checks read: the person's own resume. */
export const sourceText = (c: ResumeContent) => resumeText(c);
