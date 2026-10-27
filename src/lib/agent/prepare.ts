import "server-only";
import { tailorForJob } from "@/lib/tailor";
import { runWithAi } from "@/lib/ai-context";
import { scoreResume } from "@/lib/ats";
import { pickArm, STYLE_ARMS, styleStats, TONE_ARMS } from "@/lib/resume/learn";
import { applyTarget } from "./jobs";
import { rpc, rpcExt } from "./svc";
import { bestName } from "./fields";
import { fullDescription } from "@/lib/jobs/fulltext";
import type { Job, LetterTone, ResumeContent, ResumeStyle } from "@/lib/types";

type ResumeRow = { id: string; target_role_id: string | null; is_master: boolean; content: ResumeContent; style: ResumeStyle | null; name: string; updated_at?: string };

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
  status: "queued" | "awaiting_approval" | "extension";
  priority?: number;
  tone?: LetterTone;
  style?: ResumeStyle;
  coverLetter?: string;
  resumeId?: string;
  /** Queue the task at once with the base resume, and return the tailoring to run afterwards (the extension fills meanwhile). */
  deferTailoring?: boolean;
}): Promise<{ taskCreated: boolean; resumeId: string | null; error?: string; tailor?: (taskId: string) => Promise<void> }> {
  const { userId, job } = input;
  const target = applyTarget(job);

  let resumeId = input.resumeId || null;
  let coverLetter = input.coverLetter || null;
  let style = input.style;
  let tone = input.tone;

  if (!resumeId || !coverLetter) {
    const resumes = await rpcExt<ResumeRow[]>("user_resumes", { user_id: userId });
    // Base = the role's own resume, else the master. Never another job's tailored copy (that would drift further each time).
    const own = resumes.filter((r) => r.is_master || !r.name.includes(" — "));
    const base = own.find((r) => input.roleId && !r.is_master && r.target_role_id === input.roleId) || own.find((r) => r.is_master) || own[0];
    if (!base) return { taskCreated: false, resumeId: null, error: "Add your resume first." };
    if (!style || !tone) {
      const apps = await rpcExt<{ status: string; resume_style: string | null; letter_tone: string | null }[]>("style_stats", { user_id: userId });
      const st = styleStats(apps || []);
      style ||= pickArm(st.styles, STYLE_ARMS, (base.style as ResumeStyle) || "classic");
      tone ||= pickArm(st.tones, TONE_ARMS, "confident");
    }
    if (input.deferTailoring) {
      const res = await rpc<{ inserted: number }>("insert_tasks", {
        user_id: userId,
        tasks: [{
          job_id: job.id,
          job: { title: job.title, company: job.company, url: job.url, country: job.country, location: job.location, role_id: input.roleId || "", match: input.match ?? "" },
          ats: target.ats, apply_url: target.url, status: input.status, priority: input.priority ?? 5,
          resume_id: base.id, resume_style: style || "classic", letter_tone: tone || "confident", cover_letter: "",
        }],
      });
      const s0 = style, t0 = tone;
      const tailor = async (taskId: string) => {
        const description = await fullDescription(job).catch(() => job.description);
        const t = await runWithAi({ userId, taskId, feature: "tailor" }, () => tailorForJob(base.content, { title: job.title, company: job.company, description, country: job.country, location: job.location }, bestName(input.name, base.content?.name), t0));
        const report = scoreResume(t.resume, t.keywords);
        const saved = await rpcExt<{ id: string }>("save_resume", { user_id: userId, role_id: input.roleId || "", name: `${job.title} — ${job.company}`, content: t.resume, ats_score: report.score, style: s0 });
        await rpc("update", { task_id: taskId, resume_id: saved.id, cover_letter: t.coverLetter, log: "Tailored resume and cover letter ready" });
      };
      return { taskCreated: res.inserted > 0, resumeId: base.id, tailor };
    }
    // Tailor against the full posting, read live from the employer (Vantage only stores a summary).
    const description = await fullDescription(job).catch(() => job.description);
    const t = await runWithAi({ userId, feature: "tailor" }, () => tailorForJob(base.content, { title: job.title, company: job.company, description, country: job.country, location: job.location }, bestName(input.name, base.content?.name), tone));
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

/**
 * Right before applying: make sure the resume going out is current and professional. If the tailored copy is
 * broken, built from an older master, or more than 12 hours old, it's rewritten now from the role resume/master.
 */
export async function ensureFreshTailoring(input: {
  taskId: string; userId: string; name: string; jobId: string; job: { title: string; company: string; country: string; location?: string | null; role_id?: string };
  resume: ResumeContent | null; resumeUpdatedAt: string | null; tone?: string | null; style?: string | null; fullName: string;
}): Promise<{ refreshed: boolean; reason?: string }> {
  const { resumeIssues } = await import("@/lib/resume/health");
  const resumes = await rpcExt<(ResumeRow & { updated_at?: string })[]>("user_resumes", { user_id: input.userId });
  const own = resumes.filter((r) => r.is_master || !r.name.includes(" — "));
  const base = own.find((r) => input.job.role_id && !r.is_master && r.target_role_id === input.job.role_id) || own.find((r) => r.is_master) || own[0];
  if (!base) return { refreshed: false };
  // The person's full name: "Gokul" (from a Google sign-in) loses to "Gokul Dhamodaran" from the resume.
  input.fullName = bestName(input.fullName || input.name, base.content?.name);
  // Only problems a rewrite can fix count: the name is fixed when the PDF is drawn, and anything the base
  // resume itself has would come straight back (rewriting again and again only wastes time).
  const baseIssues = new Set(resumeIssues(base.content, input.fullName));
  const issues = resumeIssues(input.resume, input.fullName).filter((i) => i !== "name incomplete" && !baseIssues.has(i));
  const age = input.resumeUpdatedAt ? Date.now() - Date.parse(input.resumeUpdatedAt) : Infinity;
  const baseNewer = base.updated_at && input.resumeUpdatedAt ? Date.parse(base.updated_at) > Date.parse(input.resumeUpdatedAt) : false;
  // Re-writing takes ~30s, so only when it matters: a broken copy, a newer master/role resume, or a copy older than two weeks.
  if (!issues.length && age < 14 * 864e5 && !baseNewer) return { refreshed: false };
  const jd = await rpcExt<{ description: string | null; location: string | null; country: string | null } | null>("job", { job_id: input.jobId }).catch(() => null);
  const tone = (input.tone as LetterTone) || "confident";
  const fullText = await fullDescription({ ...(input.job as unknown as Job), id: input.jobId, description: jd?.description || null, desc_len: (jd as { desc_len?: number } | null)?.desc_len ?? 999999 }).catch(() => jd?.description || null);
  const t = await runWithAi({ userId: input.userId, taskId: input.taskId, feature: "tailor" }, () => tailorForJob(base.content, { title: input.job.title, company: input.job.company, description: fullText || jd?.description || null, country: input.job.country || jd?.country || "US", location: input.job.location || jd?.location }, input.fullName || input.name, tone));
  // The rewrite itself must pass the gate; otherwise keep the clean base resume rather than send something broken.
  const content = resumeIssues(t.resume, input.fullName).length ? base.content : t.resume;
  const report = scoreResume(content, t.keywords);
  const saved = await rpcExt<{ id: string }>("save_resume", { user_id: input.userId, role_id: input.job.role_id || "", name: `${input.job.title} — ${input.job.company}`, content, ats_score: report.score, style: input.style || base.style || "classic" });
  await rpc("update", { task_id: input.taskId, resume_id: saved.id, cover_letter: t.coverLetter, log: "Rewrote the resume and cover letter for this job before applying" });
  return { refreshed: true, reason: issues.join(", ") || (baseNewer ? "newer master resume" : "older than two weeks") };
}
