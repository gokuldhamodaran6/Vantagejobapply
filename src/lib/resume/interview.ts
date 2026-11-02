import "server-only";
import { aiConfigured, claude, extractJson } from "@/lib/ai";
import { playbookFor } from "@/lib/resume/playbooks";
import { gradeLines, skillLabel, type SkillProof } from "@/lib/resume/recruiter";
import type { ResumeContent } from "@/lib/types";

/**
 * Interview kit: every strong line on the resume becomes a story the person can tell in two minutes
 * (situation, their part, what they did, the result), matched to the questions this interviewer is likely to ask.
 * Built only from the resume's own facts; anything only the person knows stays a [bracketed prompt] for them to fill.
 */

export type Story = { ref: string; role: string; line: string; situation: string; part: string; action: string; result: string; ready: boolean };
export type Question = { group: "resume" | "posting" | "company" | "behavioral"; q: string; use: string; tip: string };
export type Gap = { skill: string; script: string };
export type InterviewKit = { target: string; company?: string; stories: Story[]; questions: Question[]; gaps: Gap[]; values: string[]; ai: boolean; at: string };

const NUM = /\d[\d,.]*\s?%?\+?/g;

/** Numbers the model wrote that are not in the resume become a prompt for the person instead. */
function guardNumbers(text: string, src: string): string {
  return (text || "").replace(NUM, (m) => (src.includes(m.trim().replace(/[,.]$/, "")) ? m : "[number]"));
}

export async function buildInterviewKit(c: ResumeContent, target: { title: string; company?: string; description?: string }, gaps: SkillProof[]): Promise<InterviewKit> {
  const lines = gradeLines(c);
  // The lines an interviewer will pick at: strongest first, then the rest of the recent roles.
  const picked = [...lines.filter((l) => l.grade === "strong"), ...lines.filter((l) => l.grade !== "strong" && l.section === "experience")].slice(0, 8);
  const refs = picked.map((l) => ({ ref: `${l.section}:${l.index}:${l.bullet}`, role: l.role, line: l.text }));
  const pb = target.company ? playbookFor(target.company) : null;
  const missing = gaps.filter((g) => g.status === "missing").slice(0, 3).map((g) => skillLabel(g.skill));
  const src = JSON.stringify(c);
  const base: InterviewKit = {
    target: target.title === target.title.toLowerCase() ? target.title.replace(/(^|\s)([a-z])/g, (_, p, c) => p + c.toUpperCase()) : target.title,
    company: target.company,
    values: pb && pb.kind !== "other" ? pb.values : [],
    stories: refs.map((r) => ({ ...r, situation: "[Where this happened and why it mattered]", part: "[What you personally owned]", action: "[Two or three things you did]", result: "[What changed because of it]", ready: false })),
    questions: [],
    gaps: missing.map((s) => ({ skill: s, script: `"I haven't used ${s} on the job. The closest thing I've done is [your closest example], and I'd get up to speed by [how]." Never claim it.` })),
    ai: false,
    at: new Date().toISOString(),
  };
  if (!aiConfigured()) return base;

  const out = await claude(
    `You are a hiring manager and interview coach preparing a candidate for an interview.
Write ONLY from the candidate's resume below. Never invent employers, tools, numbers, team sizes, outcomes or scope.
When a story needs a detail the resume does not give, write a short prompt in [square brackets] for the candidate to fill, e.g. "[how many hours a week this saved]".
Keep shared credit honest: if the resume says "contributed to" or "supported", the story says the team got the result and names the candidate's own part.
Plain words, second person ("you"), no buzzwords.

Return JSON only:
{"stories":[{"ref":string,"situation":string,"part":string,"action":string,"result":string}],
 "questions":[{"group":"resume"|"posting"|"company"|"behavioral","q":string,"use":string,"tip":string}],
 "gaps":[{"skill":string,"script":string}]}
- stories: one per line given, same "ref". situation = context in one sentence; part = what the candidate owned; action = 2-3 concrete steps; result = the outcome exactly as the resume states it (or a [bracketed prompt] if none).
- questions: 12 total. 4 "resume" (what an interviewer will probe on these exact lines), 4 "posting" (role-specific, from the job), ${pb && pb.kind !== "other" ? `2 "company" (from ${pb.name}'s published hiring criteria: ${pb.values.slice(0, 4).join("; ")})` : `2 "company" (what this kind of employer screens for)`}, 2 "behavioral". "use" names the story to use (its role and a few words of the line) or says how to approach it. "tip" is one sentence on what a strong answer shows.
- gaps: for each missing skill, an honest 2-sentence script: say plainly they haven't used it, bridge to the closest real experience from the resume, never claim it.`,
    [{ role: "user", content: `TARGET: ${target.title}${target.company ? ` at ${target.company}` : ""}\n${target.description ? `JOB POSTING:\n${target.description.slice(0, 5000)}\n` : ""}\nMISSING SKILLS: ${missing.join(", ") || "none"}\n\nLINES TO TURN INTO STORIES:\n${refs.map((r) => `${r.ref} | ${r.role} | ${r.line}`).join("\n")}\n\nFULL RESUME:\n${src.slice(0, 14000)}` }],
    5000,
    { model: "writer", temperature: 0.3, feature: "interview-kit" },
  );
  const ai = extractJson<{ stories?: Partial<Story>[]; questions?: Question[]; gaps?: Gap[] }>(out);
  if (!ai) return base;
  const g = (s?: string) => guardNumbers((s || "").trim(), src);
  const stories = base.stories.map((s) => {
    const a = ai.stories?.find((x) => x.ref === s.ref);
    if (!a) return s;
    const st = { ...s, situation: g(a.situation) || s.situation, part: g(a.part) || s.part, action: g(a.action) || s.action, result: g(a.result) || s.result };
    return { ...st, ready: ![st.situation, st.part, st.action, st.result].some((x) => /\[[^\]]+\]/.test(x)) };
  });
  const questions = (ai.questions || []).filter((q) => q && q.q && ["resume", "posting", "company", "behavioral"].includes(q.group)).slice(0, 14).map((q) => ({ ...q, q: q.q.trim(), use: g(q.use), tip: g(q.tip) }));
  const gapsOut = (ai.gaps || []).filter((x) => x?.skill && x.script && missing.some((m) => m.toLowerCase() === x.skill.toLowerCase())).map((x) => ({ skill: x.skill, script: g(x.script) }));
  return { ...base, stories, questions, gaps: gapsOut.length ? gapsOut : base.gaps, ai: true };
}
