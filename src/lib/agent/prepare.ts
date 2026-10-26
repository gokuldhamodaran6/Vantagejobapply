import "server-only";
import { tailorForJob } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats";
import { pickArm, STYLE_ARMS, styleStats, TONE_ARMS } from "@/lib/resume/learn";
import { applyTarget } from "./jobs";
import { rpc, rpcExt } from "./svc";
import type { Job, LetterTone, ResumeContent, ResumeStyle } from "@/lib/types";

type ResumeRow = { id: string; target_role_id: string | null; is_master: boolean; content: ResumeContent; style: ResumeStyle | null; name: string };

/**
 * Prepare one application end to end: choose the best base resume, pick style/tone (learning from interviews),
 * tailor resume + cover letter to the job, save the tailored resume, and queue the agent task.
 */
export async function prepareAndQueue(input: {
  userId: string;
  name: string;
  job: Job;
  roleId?: string | null;
  match?: number | null;
  status: "queued" | "awaiting_approval";
  priority?: number;
  tone?: LetterTone;
  style?: ResumeStyle;
  coverLetter?: string;
  resumeId?: string;
}): Promise<{ taskCreated: boolean; resumeId: string | null; error?: string }> {
  const { userId, job } = input;
  const target = applyTarget(job);

  let resumeId = input.resumeId || null;
  let coverLetter = input.coverLetter || null;
  let style = input.style;
  let tone = input.tone;

  if (!resumeId || !coverLetter) {
    const resumes = await rpcExt<ResumeRow[]>("user_resumes", { user_id: userId });
    const base = resumes.find((r) => input.roleId && r.target_role_id === input.roleId) || resumes.find((r) => r.is_master) || resumes[0];
    if (!base) return { taskCreated: false, resumeId: null, error: "Add your resume first." };
    if (!style || !tone) {
      const apps = await rpcExt<{ status: string; resume_style: string | null; letter_tone: string | null }[]>("style_stats", { user_id: userId });
      const st = styleStats(apps || []);
      style ||= pickArm(st.styles, STYLE_ARMS, (base.style as ResumeStyle) || "classic");
      tone ||= pickArm(st.tones, TONE_ARMS, "confident");
    }
    const t = await tailorForJob(base.content, { title: job.title, company: job.company, description: job.description, country: job.country, location: job.location }, input.name, tone);
    coverLetter = coverLetter || t.coverLetter;
    const report = scoreResume(t.resume, t.keywords);
    const saved = await rpcExt<{ id: string }>("save_resume", {
      user_id: userId, role_id: input.roleId || "", name: `${job.title} — ${job.company}`, content: t.resume, ats_score: report.score, style,
    });
    resumeId = saved.id;
  }

  const res = await rpc<{ inserted: number }>("insert_tasks", {
    user_id: userId,
    tasks: [{
      job_id: job.id,
      job: { title: job.title, company: job.company, url: job.url, country: job.country, location: job.location, role_id: input.roleId || "", match: input.match ?? "" },
      ats: target.ats,
      apply_url: target.url,
      status: input.status,
      priority: input.priority ?? 5,
      resume_id: resumeId,
      resume_style: style || "classic",
      letter_tone: tone || "confident",
      cover_letter: coverLetter || "",
    }],
  });
  return { taskCreated: res.inserted > 0, resumeId };
}
