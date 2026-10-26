import "server-only";
import { claude, extractJson } from "@/lib/ai";
import { extractKeywords, parseResumeText, resumeText, scoreResume } from "@/lib/ats";
import type { ResumeContent } from "@/lib/types";

const TRUTH_RULES = `Rules you must follow:
- Use ONLY facts present in the candidate's resume. Never invent employers, titles, dates, degrees, skills, tools, certifications or numbers.
- You may rephrase, reorder, merge and emphasise existing facts, and mirror the job's wording when the resume already supports it.
- Keep a single-column, ATS-friendly structure with standard section names.
- Bullets: start with a strong past-tense verb, describe what was done and the measurable result (only numbers already present).`;

export async function structureResume(raw: string, name: string): Promise<ResumeContent> {
  const parsed = parseResumeText(raw, name);
  const out = await claude(
    `You convert a pasted resume into JSON. ${TRUTH_RULES}
Return ONLY JSON matching: {"name":string,"headline":string,"location":string,"email":string,"phone":string,"links":string[],"summary":string,"skills":[{"group":string,"items":string[]}],"experience":[{"title":string,"company":string,"location":string,"start":string,"end":string,"bullets":string[]}],"projects":[{"name":string,"tech":string,"bullets":string[]}],"education":[{"degree":string,"school":string,"location":string,"end":string,"details":string}],"certifications":string[]}. Use "MM/YYYY" dates where the resume gives them.`,
    [{ role: "user", content: raw.slice(0, 20000) }],
    3000,
  );
  return extractJson<ResumeContent>(out) || parsed;
}

export type TailorResult = { resume: ResumeContent; coverLetter: string; keywords: string[]; ai: boolean };

export async function tailorForJob(base: ResumeContent, job: { title: string; company: string; description: string | null; country: string }, candidateName: string): Promise<TailorResult> {
  const keywords = extractKeywords(`${job.title} ${job.description || ""}`, 20);
  const out = await claude(
    `You are an expert resume writer and recruiter. Tailor the candidate's resume to the job and write a short cover letter. ${TRUTH_RULES}
Cover letter: 150-220 words, plain and specific, name the company and role, connect 2 real achievements to the job's needs, no clichés, no placeholders, sign with the candidate's name. Use local spelling for the job's country (${job.country}).
Return ONLY JSON: {"resume": <same schema as input>, "coverLetter": string}`,
    [
      {
        role: "user",
        content: `JOB: ${job.title} at ${job.company} (${job.country})\n${(job.description || "").slice(0, 8000)}\n\nPRIORITY KEYWORDS (use only if supported by the resume): ${keywords.join(", ")}\n\nCANDIDATE RESUME JSON:\n${JSON.stringify(base)}`,
      },
    ],
    3500,
  );
  const parsed = extractJson<{ resume: ResumeContent; coverLetter: string }>(out);
  if (parsed?.resume && parsed.coverLetter) {
    // Guard against invented skills: drop skill items that aren't in the original resume text.
    const original = resumeText(base).toLowerCase();
    parsed.resume.skills = (parsed.resume.skills || []).map((g) => ({ ...g, items: g.items.filter((i) => original.includes(i.toLowerCase())) })).filter((g) => g.items.length);
    return { resume: parsed.resume, coverLetter: parsed.coverLetter, keywords, ai: true };
  }
  return { ...ruleBasedTailor(base, job, keywords, candidateName), keywords, ai: false };
}

function ruleBasedTailor(base: ResumeContent, job: { title: string; company: string }, keywords: string[], name: string) {
  const kw = keywords.map((k) => k.toLowerCase());
  const hits = (s: string) => kw.filter((k) => s.toLowerCase().includes(k)).length;
  const resume: ResumeContent = JSON.parse(JSON.stringify(base));
  resume.skills = (resume.skills || []).map((g) => ({ ...g, items: [...g.items].sort((a, b) => hits(b) - hits(a)) }));
  resume.experience = (resume.experience || []).map((e) => ({ ...e, bullets: [...e.bullets].sort((a, b) => hits(b) - hits(a) || (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0)) }));
  const best = (resume.experience || []).flatMap((e) => e.bullets.map((b) => ({ b, e }))).sort((x, y) => hits(y.b) - hits(x.b) || (/\d/.test(y.b) ? 1 : 0) - (/\d/.test(x.b) ? 1 : 0)).slice(0, 2);
  const matched = scoreResume(resume, keywords).matched.slice(0, 4);
  const first = (name || resume.name || "").split(" ")[0];
  const coverLetter = [
    `Dear ${job.company} hiring team,`,
    "",
    `I'm applying for the ${job.title} role. ${matched.length ? `My background in ${matched.join(", ")} lines up closely with what you're looking for.` : "My experience lines up closely with what you're looking for."}`,
    "",
    ...best.map((x) => `At ${x.e.company || "my last role"}, I ${x.b.charAt(0).toLowerCase()}${x.b.slice(1).replace(/\.$/, "")}.`),
    "",
    `I'd welcome the chance to bring the same focus to ${job.company}. Thank you for your time.`,
    "",
    "Sincerely,",
    resume.name || first,
  ].join("\n");
  return { resume, coverLetter };
}
