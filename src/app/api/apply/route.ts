import { json, loadUserContext } from "@/lib/server-user";
import { prepareAndQueue } from "@/lib/agent/prepare";
import { applyTarget } from "@/lib/agent/jobs";
import { rpc } from "@/lib/agent/svc";
import { buildReport, saveReport } from "@/lib/agent/report";
import { matchJob } from "@/lib/jobs/match";
import type { Job, LetterTone, ResumeContent, ResumeStyle } from "@/lib/types";

export const maxDuration = 120;

/**
 * "Tailor & apply": the resume and cover letter written for this job are saved, the job goes into Applications as
 * "Ready", and an application is opened for the Chrome extension to fill on the company's own site. Nothing is sent
 * by Vantage — the person presses Submit there, and the extension records it.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const b = (await req.json().catch(() => ({}))) as {
    jobId?: string; roleId?: string | null; resume?: ResumeContent; coverLetter?: string; style?: ResumeStyle; tone?: LetterTone; atsScore?: number; force?: boolean;
    match?: { covered: number; total: number; skills: { skill: string; evidence: string | null }[] };
    format?: { code: string; label?: string; docName: string; paper: string; pages?: number; note: string };
    harvard?: { ok: number; total: number };
  };
  if (!b.jobId) return json({ error: "Pick a job first." }, 400);
  const { data } = await ctx.supabase.from("jobs").select("*").eq("id", b.jobId).maybeSingle();
  const job = (data as Job) || null;
  if (!job) return json({ error: "Job not found." }, 404);
  if ((job as { closed_at?: string | null }).closed_at) return json({ error: `${job.company} has closed this job.` }, 410);

  // Already applied (this posting, a repost or the same role at the same company)? Say so; the person can still go on.
  if (!b.force) {
    const { data: blocked } = await ctx.supabase.rpc("apply_check", { p_job_id: job.id, p_company: job.company, p_title: job.title });
    if (blocked) return json({ error: `${blocked} — ${job.title} at ${job.company}.`, duplicate: true }, 409);
  }

  const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth });
  const roleId = b.roleId ?? match.role?.id ?? null;

  // The tailored resume the person just looked at becomes its own saved resume (named for the job).
  let resumeId: string | undefined;
  if (b.resume) {
    const { data: r, error } = await ctx.supabase.from("resumes").insert({
      user_id: ctx.user.id, name: `${job.title} — ${job.company}`, is_master: false, target_role_id: roleId,
      content: b.resume, ats_score: typeof b.atsScore === "number" ? Math.round(b.atsScore) : null, style: b.style || null,
    }).select("id").single();
    if (error) return json({ error: `Couldn't save the resume: ${error.message}` }, 500);
    resumeId = r.id as string;
  }

  const q = await prepareAndQueue({
    userId: ctx.user.id, name: ctx.profile?.full_name || "", job, roleId, match: match.score, status: "extension", priority: 9,
    resumeId, coverLetter: b.coverLetter || undefined, style: b.style, tone: b.tone,
  });
  if (q.error) return json({ error: q.error }, 400);

  const { data: task } = await ctx.supabase.from("agent_tasks").select("id,status,resume_id,cover_letter,apply_url").eq("user_id", ctx.user.id).eq("job_id", job.id).maybeSingle();
  if (!task) return json({ error: "Couldn't open this application. Try again." }, 500);
  if (task.status === "submitted") return json({ error: `You already applied to ${job.title} at ${job.company}.`, duplicate: true }, 409);
  // An application already open for this job keeps its place, with the newest resume and letter.
  if (resumeId && (task.resume_id !== resumeId || (b.coverLetter && task.cover_letter !== b.coverLetter))) {
    await rpc("update", { task_id: task.id, resume_id: resumeId, ...(b.coverLetter ? { cover_letter: b.coverLetter } : {}), log: "New resume and cover letter written for this job" });
  }

  // What this resume covers, for the extension's panel (counts come from the tailoring the person just saw).
  if (b.match && b.format && b.harvard && Array.isArray(b.match.skills)) {
    await saveReport(task.id, buildReport({ match: { covered: Number(b.match.covered) || 0, total: Number(b.match.total) || 0, skills: b.match.skills.slice(0, 12).map((x) => ({ skill: String(x.skill).slice(0, 80), evidence: x.evidence ? String(x.evidence).slice(0, 200) : null })) }, format: b.format, harvard: { ok: Number(b.harvard.ok) || 0, total: Number(b.harvard.total) || 0 }, resumeId: resumeId || task.resume_id }));
  }

  // In Applications as "Ready" (never moves an application backwards).
  const now = new Date().toISOString();
  const { data: existing } = await ctx.supabase.from("applications").select("id,status,events").eq("user_id", ctx.user.id).eq("job_id", job.id).maybeSingle();
  const row = { resume_id: resumeId || q.resumeId, cover_letter: b.coverLetter || null, resume_style: b.style || null, letter_tone: b.tone || null, agent_task_id: task.id };
  if (existing) {
    const early = ["saved", "ready"].includes(String(existing.status));
    await ctx.supabase.from("applications").update({
      ...row, ...(early ? { status: "ready" } : {}),
      events: [...((existing.events as unknown[]) || []), { at: now, type: "ready", text: "Resume and cover letter written for this job — opened with the Chrome extension" }],
    }).eq("id", existing.id);
  } else {
    await ctx.supabase.from("applications").insert({
      user_id: ctx.user.id, job_id: job.id, target_role_id: roleId, status: "ready", match_score: match.score, source: "extension",
      job: { title: job.title, company: job.company, url: job.url, country: job.country, location: job.location },
      events: [{ at: now, type: "ready", text: "Resume and cover letter written for this job — opened with the Chrome extension" }],
      ...row,
    });
  }

  const target = applyTarget(job);
  return json({ ok: true, taskId: task.id, url: task.apply_url || target.url || job.url, job: { title: job.title, company: job.company }, match: match.score, ats: target.ats });
}
