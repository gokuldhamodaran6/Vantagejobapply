import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { extractKeywords, resumeText, scoreResume } from "@/lib/ats";
import { studio, type JobBrief, type Review, type Strategy } from "@/lib/resume/studio";
import { polishResume } from "@/lib/resume/polish";
import { fitToPages } from "@/lib/resume/pdf";
import { repairResume } from "@/lib/resume/repair";
import { SCHEMA, clean, coverage, formatPrompt, lintLetter, norm } from "@/lib/resume/rules";
import { parseResumeText } from "@/lib/resume/parse";
import { formatFor, pagesFor, type CountryFormat } from "@/lib/resume/country";
import { harvardScore, lintBullets, type HarvardSummary } from "@/lib/resume/harvard";
import type { LetterTone, ResumeContent } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Structuring an uploaded/pasted resume                               */
/* ------------------------------------------------------------------ */

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
    { model: "writer", temperature: 0, feature: "resume-parse" },
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

export async function roleResume(
  master: ResumeContent,
  role: { title: string; levels: string[] },
  marketKeywords: string[],
  country = "US",
  coach?: { facts: string; level?: "strong" | "adjacent" | "switch"; courses?: string[] },
): Promise<{ content: ResumeContent; notes: string[]; ai: boolean }> {
  // What the candidate told us about this role counts as their own facts (the truth guard accepts them).
  const facts: ResumeContent = coach?.facts
    ? { ...master, additional: [...(master.additional || []), coach.facts], certifications: [...(master.certifications || []), ...(coach.courses || [])] }
    : master;
  const switching = coach?.level === "switch" || coach?.level === "adjacent";
  if (aiConfigured()) {
    const description = `Target: ${role.title} roles (${role.levels.join("/")} level) in ${country}. This is a role-level master resume, not one posting: optimise for what most ${role.title} hiring managers screen for.
Skills and phrases that appear most often in live ${role.title} postings: ${marketKeywords.join(", ")}.${switching ? `
The candidate is moving into ${role.title} from a related or different field: lead with transferable results, bridge them to what a ${role.title} does, and never pretend they held the title. Put projects and relevant training where they help.` : ""}${coach?.facts ? `
The candidate also told us (their own words, usable as facts):
${coach.facts.slice(0, 4000)}` : ""}`;
    const s = await studio(repairResume(facts), { title: role.title, company: `${role.title} employers`, description, country }, { fmt: formatFor(country), onePage: pagesFor(formatFor(country), master) === 1, tone: "confident", keywords: marketKeywords, withLetter: false }).catch(() => null);
    if (s) {
      const content = { ...s.resume, additional: master.additional }; // the Q&A itself never appears on the resume
      const notes = [...s.strategy.questions, ...(s.review?.risks || [])].slice(0, 5);
      return { content, notes: notes.length ? notes : ruleNotes(master), ai: true };
    }
  }
  const content = ruleRoleResume(master, role.title, marketKeywords);
  if (coach?.courses?.length) content.certifications = [...(content.certifications || []), ...coach.courses.filter((c) => !(content.certifications || []).includes(c))];
  return { content, notes: ruleNotes(master), ai: false };
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
  /** The job country's resume/CV rules the writer followed. */
  format: CountryFormat & { pages: 1 | 2 };
  /** Harvard bullet checks run on the tailored resume (no AI). */
  harvard: HarvardSummary;
  /** How the person is presented for this job, honest gaps, and questions that would add real numbers. */
  strategy?: Pick<Strategy, "identity" | "angle" | "pillars" | "gaps" | "questions">;
  /** The hiring-manager review of the final version (AI estimate). */
  review?: Review | null;
  /** Hard screening requirements in the posting and whether the resume shows them. */
  knockouts?: JobBrief["knockouts"];
  employer?: { name: string; kind: string; values: string[] };
  stages?: string[];
};

type JobIn = { title: string; company: string; description: string | null; country: string; location?: string | null };

export async function tailorForJob(base0: ResumeContent, job: JobIn, candidateName: string, tone: LetterTone = "confident", country: string = job.country): Promise<TailorResult> {
  // Stored resumes from older imports can carry layout damage; repair it before anything reads it.
  const base = repairResume(base0);
  const keywords = extractKeywords(`${job.title} ${job.title} ${job.description || ""}`, 22);
  // Never "GOKUL DHAMODARAN" in a letter's sign-off: the profile's full name, or the resume's in normal case.
  const nm = (base.name || "").trim();
  if (!nm || (candidateName && candidateName.split(/\s+/).length > nm.split(/\s+/).length)) base.name = candidateName || nm;
  else if (nm === nm.toUpperCase() || nm === nm.toLowerCase()) base.name = nm.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  const fmt = formatFor(country || job.country);
  const format = { ...fmt, pages: pagesFor(fmt, base) };
  const checked = (resume: ResumeContent) => harvardScore(resume, lintBullets(resume));
  if (aiConfigured()) {
    const s = await studio(base, job, { fmt, onePage: format.pages === 1, tone, keywords }).catch((e) => {
      console.error("resume studio failed", (e as Error).message);
      return null;
    });
    if (s) {
      // The page target is real: measure the PDF and trim the least valuable lines until it fits.
      // One strong page beats two, but two strong pages beat one thin page: if one page would leave fewer than
      // ~10 achievement bullets, the resume gets a second page instead.
      const opts = { country: country || job.country };
      const bulletsOf = (r: ResumeContent) => (r.experience || []).reduce((n, e) => n + (e.bullets || []).length, 0);
      let fit = await fitToPages(s.resume, format.pages, opts).catch(() => null);
      if (fit && format.pages === 1 && (fit.pages > 1 || bulletsOf(fit.resume) < Math.min(10, bulletsOf(s.resume)))) {
        fit = await fitToPages(s.resume, 2, opts).catch(() => fit);
        if (fit) format.pages = 2;
      }
      if (fit) s.resume = fit.resume;
      const letter = s.coverLetter || ruleLetter(s.resume, job, keywords, tone);
      const analysis = s.strategy.requirements.map((r) => ({ requirement: r.requirement, evidence: r.evidence ?? null })).filter((r) => r.requirement);
      return {
        resume: s.resume,
        coverLetter: letter,
        keywords: [...new Set([...(s.strategy.keywords || []), ...keywords])].slice(0, 30),
        ai: true,
        tone,
        analysis: analysis.slice(0, 8),
        letterIssues: s.coverLetter ? s.letterIssues : lintLetter(letter, job.company),
        format,
        harvard: checked(s.resume),
        strategy: { identity: s.strategy.identity, angle: s.strategy.angle, pillars: s.strategy.pillars, gaps: s.strategy.gaps, questions: s.strategy.questions },
        review: s.review,
        knockouts: s.brief?.knockouts || [],
        employer: s.playbook,
        stages: s.stages,
      };
    }
  }
  const resume = polishResume(ruleRoleResume(base, job.title, keywords), { jobTitle: job.title, identity: (base.headline || "").split(" | ")[0] || base.experience?.[0]?.title || "", original: base });
  const letter = ruleLetter(resume, job, keywords, tone);
  return { resume, coverLetter: letter, keywords, ai: false, tone, analysis: [], letterIssues: lintLetter(letter, job.company), format, harvard: checked(resume) };
}

/* ------------------------------------------------------------------ */
/* Honest match: which key skills the person's own history covers      */
/* ------------------------------------------------------------------ */

export type JobMatch = {
  /** Key skills with evidence from the person's own resume. Never more than total. */
  covered: number;
  total: number;
  skills: { skill: string; evidence: string | null }[];
};

const clip = (q: string) => (q.length > 110 ? `${q.slice(0, q.lastIndexOf(" ", 105) > 40 ? q.lastIndexOf(" ", 105) : 105)}…` : q);

/** A short phrase from the person's own resume that shows this skill, or null. */
export function evidenceFor(skill: string, c: ResumeContent): string | null {
  const k = skill.toLowerCase().trim();
  if (!k) return null;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  const hit = [
    ...(c.experience || []).flatMap((e) => e.bullets || []),
    ...(c.projects || []).flatMap((p) => p.bullets || []),
    ...(c.skills || []).map((g) => `${g.group}: ${g.items.join(", ")}`),
    ...(c.certifications || []),
    ...(c.education || []).map((e) => [e.degree, e.school, e.details].filter(Boolean).join(", ")),
    c.summary || "",
    c.headline || "",
  ].find((t) => t && re.test(t));
  return hit ? clip(hit.replace(/\s+/g, " ").trim()) : null;
}

/**
 * Build the match from the job's key requirements. With an AI analysis, its evidence is kept only when it really
 * comes from the person's own resume; otherwise it falls back to the posting's keywords. Nothing is ever
 * counted as covered without evidence, so the score can't be inflated.
 */
export function matchFrom(analysis: { requirement: string; evidence: string | null }[], keywords: string[], own: ResumeContent): JobMatch {
  const src = norm(resumeText(own));
  const skills = analysis.length
    ? analysis.filter((a) => a?.requirement?.trim()).slice(0, 8).map((a) => {
        const q = (a.evidence || "").replace(/^["“']|["”']$/g, "").trim();
        // The AI's quote must be (nearly) word-for-word from the resume; else look for our own phrase.
        const real = q && coverage(q, src) >= 0.7 ? clip(q) : null;
        if (real || !a.evidence) return { skill: a.requirement.trim(), evidence: real };
        const terms = [a.requirement, ...extractKeywords(a.requirement, 6)];
        return { skill: a.requirement.trim(), evidence: terms.map((t) => evidenceFor(t, own)).find(Boolean) ?? null };
      })
    : [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 10).map((k) => ({ skill: k, evidence: evidenceFor(k, own) }));
  return { covered: skills.filter((s) => s.evidence).length, total: skills.length, skills };
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

export { lintLetter, formatPrompt };
