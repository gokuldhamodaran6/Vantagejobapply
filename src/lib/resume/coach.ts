import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { resumeText } from "@/lib/ats";
import { roleSimilarity } from "@/lib/jobs/roles";
import type { ResumeContent } from "@/lib/types";

export type Fit = { level: "strong" | "adjacent" | "switch"; score: number; matched: string[]; missing: string[]; closestTitle: string | null; why: string };
export type CoachQuestion = { key: string; q: string; hint?: string };
export type CoachAnswer = { key: string; q: string; a: string };
export type Coach = { fit?: Fit; questions?: CoachQuestion[]; answers?: CoachAnswer[]; assessedAt?: string; answeredAt?: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").replace(/\s+/g, " ").trim();

/** How well the master resume already fits a target role — the way a recruiter would read it in 10 seconds. */
export function assessFit(master: ResumeContent, roleTitle: string, keywords: string[]): Fit {
  const text = norm(resumeText(master));
  const titles = (master.experience || []).map((e) => e.title).filter(Boolean);
  const best = titles.map((t) => ({ t, s: roleSimilarity(roleTitle, t) })).sort((a, b) => b.s - a.s)[0];
  const kw = keywords.filter((k) => norm(k) !== norm(roleTitle)).slice(0, 20);
  const matched = kw.filter((k) => text.includes(norm(k)));
  const missing = kw.filter((k) => !text.includes(norm(k)));
  const kwShare = kw.length ? matched.length / kw.length : 0;
  const titleSim = best?.s || 0;
  const score = Math.round((titleSim * 0.55 + kwShare * 0.45) * 100);
  const level: Fit["level"] = titleSim >= 0.6 || score >= 60 ? "strong" : titleSim >= 0.3 || score >= 35 ? "adjacent" : "switch";
  const why =
    level === "strong" ? `Your experience as ${best?.t || "your current role"} lines up closely with ${roleTitle} roles.`
      : level === "adjacent" ? `Your background is close to ${roleTitle}. Recruiters will look for ${missing.slice(0, 3).join(", ") || "a few specific skills"} — tell us where you've done them.`
        : `${roleTitle} would be a career move from ${best?.t || "your current field"}. A strong switch resume bridges what you've proven to what this role needs.`;
  return { level, score, matched, missing, closestTitle: best?.t || null, why };
}

/** The questions a top recruiter would ask before writing this person's resume for this role. */
export async function coachQuestions(master: ResumeContent, roleTitle: string, fit: Fit): Promise<CoachQuestion[]> {
  const gaps = fit.missing.slice(0, 6);
  const base: CoachQuestion[] = [
    { key: "know", q: `In your own words, what does a ${roleTitle} do day to day — and which parts of that have you already done in your work?`, hint: "Think of meetings you ran, decisions you drove, problems you owned." },
    ...(gaps.length ? [{ key: "gaps", q: `Have you done any of these, even partly: ${gaps.join(", ")}? A line on each one you've touched is enough.`, hint: "Side projects, school and volunteer work count." }] : []),
    { key: "courses", q: `Any courses, certificates or bootcamps related to ${roleTitle}? Include the name, where, and the year.`, hint: "e.g. “Google Project Management Certificate, Coursera, 2025”" },
    { key: "projects", q: `A project that shows you can do ${roleTitle} work — what was the goal, what did you do, and what changed because of it?`, hint: "Real numbers help most: users, time saved, revenue, adoption." },
    { key: "why", q: `Why ${roleTitle}, and why now?`, hint: "One or two lines. We use it to frame your summary and cover letters." },
  ];
  if (fit.level === "strong") return [{ key: "recent", q: `Anything recent we should add for ${roleTitle} roles — a new result, tool, certificate or project?` }];
  if (!aiConfigured()) return base;
  const out = await claude(
    `You are a top recruiter preparing to rewrite a candidate's resume for a ${roleTitle} role. Their background: ${fit.closestTitle || "different field"}. Gaps vs live ${roleTitle} postings: ${gaps.join(", ") || "none obvious"}.
Write 4–5 short, friendly, specific questions that uncover REAL, provable experience for this role (transferable work, training, projects, tools). One topic per question. Plain words, no jargon.
Return ONLY JSON: [{"key":"short_id","q":"question","hint":"one short example of a good answer"}]`,
    [{ role: "user", content: `RESUME (summary and experience titles/bullets):\n${JSON.stringify({ summary: master.summary, experience: (master.experience || []).map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 3) })), skills: master.skills })}` }],
    900,
    { model: "fast", temperature: 0.4 },
  );
  const qs = extractJson<CoachQuestion[]>(out);
  return Array.isArray(qs) && qs.length >= 3 ? qs.slice(0, 5).map((x, i) => ({ key: String(x.key || `q${i}`).slice(0, 30), q: String(x.q).slice(0, 300), hint: x.hint ? String(x.hint).slice(0, 200) : undefined })) : base;
}

/** The candidate's own statements, formatted as facts the resume writer may use (and the truth guard accepts). */
export function coachFacts(answers: CoachAnswer[] = []): string {
  return answers.filter((x) => x.a.trim()).map((x) => `Q: ${x.q}\nA: ${x.a.trim()}`).join("\n\n");
}
