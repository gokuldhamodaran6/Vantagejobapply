import { json, loadUserContext } from "@/lib/server-user";
import { jobFromLink } from "@/lib/agent/jobs";
import { prepareAndQueue } from "@/lib/agent/prepare";
import { rpcExt, wakeWorker } from "@/lib/agent/svc";
import { matchJob } from "@/lib/jobs/match";
import { dailyLimit } from "@/lib/access";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job, LetterTone, ResumeContent, ResumeStyle } from "@/lib/types";

export const maxDuration = 120;

/**
 * Start an application with the agent — from a job in Vantage or any pasted job link.
 * The click itself is the user's approval, so the task goes straight into the queue.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string; link?: string; roleId?: string | null; tone?: LetterTone; style?: ResumeStyle;
    resume?: ResumeContent; coverLetter?: string; atsScore?: number; later?: boolean;
  };

  let job: Job | null = null;
  if (body.jobId) {
    const { data } = await ctx.supabase.from("jobs").select("*").eq("id", body.jobId).maybeSingle();
    job = (data as Job) || null;
  } else if (body.link) {
    const found = await jobFromLink(body.link);
    if (!found) return json({ error: "We couldn't read that job link. Check it opens the job on the company's site and try again." }, 400);
    job = found.job;
    // Only jobs read from an official careers feed join the shared job pool; other pages stay private to this task.
    if (found.board) {
      await rpcExt("store_job", { job });
      await supabaseAnon().rpc("upsert_board", { secret: ingestSecret(), p: { ats: found.board.ats, token: found.board.token, name: found.board.name, host: found.board.host || null, site: found.board.site || "", added_by: ctx.user.id } }).then(() => {}, () => {});
    }
  }
  if (!job) return json({ error: "Job not found." }, 404);

  // The daily limit covers every application the agent sends, including ones you start yourself.
  if (!body.later) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ count: sentToday }, { count: inLine }] = await Promise.all([
      ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "submitted").gte("finished_at", today.toISOString()),
      ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).in("status", ["queued", "running", "waiting_code", "needs_human"]),
    ]);
    const limit = dailyLimit(ctx.profile as { daily_limit?: number; high_volume_ok?: boolean }, ctx.plan);
    if ((sentToday || 0) + (inLine || 0) >= limit) {
      return json({ error: `You've reached today's limit of ${limit} applications by your agent. Save it for tomorrow, apply yourself with the Chrome extension, or raise the limit in Settings.` }, 429);
    }
  }

  const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth });
  if (!match.eligible && body.jobId) return json({ error: `This job can't hire you: ${match.blockers[0]}.` }, 400);

  let resumeId: string | undefined;
  if (body.resume) {
    const { data, error } = await ctx.supabase.from("resumes").insert({
      user_id: ctx.user.id, name: `${job.title} — ${job.company}`, is_master: false, target_role_id: body.roleId || match.role?.id || null,
      content: body.resume, ats_score: body.atsScore ?? null, style: body.style || "classic",
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    resumeId = data.id;
  }

  const r = await prepareAndQueue({
    userId: ctx.user.id,
    name: ctx.profile.full_name || "",
    job,
    roleId: body.roleId || match.role?.id || null,
    match: match.score,
    status: body.later ? "awaiting_approval" : "queued",
    priority: 2,
    tone: body.tone,
    style: body.style,
    coverLetter: body.coverLetter,
    resumeId,
  });
  if (r.error) return json({ error: r.error }, 400);
  if (!r.taskCreated) return json({ error: "Your agent already has this job in its queue.", duplicate: true }, 409);
  void wakeWorker();
  return json({ ok: true, job: { id: job.id, title: job.title, company: job.company }, eligible: match.eligible, blockers: match.blockers });
}
