import { tailorForJob } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats";
import { pickArm, STYLE_ARMS, styleStats, TONE_ARMS } from "@/lib/resume/learn";
import { json, loadUserContext } from "@/lib/server-user";
import { runWithAi } from "@/lib/ai-context";
import type { Job, LetterTone, Resume, ResumeContent, ResumeStyle } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { jobId?: string; job?: Partial<Job>; roleId?: string | null; tone?: LetterTone; style?: ResumeStyle };

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await ctx.supabase.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("type", "tailor").gte("created_at", monthStart.toISOString());
  if ((count || 0) >= ctx.plan.limits.tailorsPerMonth) {
    return json({ error: `You've reached this month's limit of ${ctx.plan.limits.tailorsPerMonth} tailored applications. It resets on the 1st.` }, 429);
  }

  let job = body.job as Job | undefined;
  if (body.jobId) {
    const { data } = await ctx.supabase.from("jobs").select("*").eq("id", body.jobId).maybeSingle();
    if (data) job = data as Job;
  }
  if (!job?.title || !job.company) return json({ error: "Job not found. Refresh your matches and try again." }, 404);

  const { data: resumes } = await ctx.supabase.from("resumes").select("*").eq("user_id", ctx.user.id);
  const list = (resumes as Resume[]) || [];
  const base =
    list.find((r) => body.roleId && r.target_role_id === body.roleId && !r.name.includes(" — ")) ||
    list.find((r) => r.is_master) ||
    list[0];
  if (!base) return json({ error: "Add your resume first — go to Resumes and upload it.", needResume: true }, 400);

  let tone = body.tone;
  let style = body.style;
  if (!tone || !style) {
    const { data: apps } = await ctx.supabase.from("applications").select("status,resume_style,letter_tone");
    const st = styleStats((apps as { status: string; resume_style: string | null; letter_tone: string | null }[]) || []);
    tone ||= pickArm(st.tones, TONE_ARMS, "confident");
    style ||= pickArm(st.styles, STYLE_ARMS, (base.style as ResumeStyle) || "classic");
  }

  const result = await runWithAi({ userId: ctx.user.id, feature: "tailor" }, () => tailorForJob(base.content as ResumeContent, { title: job.title, company: job.company, description: job.description, country: job.country, location: job.location }, ctx.profile.full_name || "", tone));
  const report = scoreResume(result.resume, result.keywords);
  await ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "tailor", meta: { job: job.id, ai: result.ai, tone, style } });
  return json({ ...result, report, style, baseResumeId: base.id, baseName: base.name });
}
