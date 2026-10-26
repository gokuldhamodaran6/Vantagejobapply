import { tailorForJob } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats";
import { json, loadUserContext } from "@/lib/server-user";
import type { Job, Resume, ResumeContent } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { jobId?: string; job?: Partial<Job>; roleId?: string | null };

  // Plan limit per calendar month.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await ctx.supabase
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("type", "tailor")
    .gte("created_at", monthStart.toISOString());
  if ((count || 0) >= ctx.plan.limits.tailorsPerMonth) {
    return json({ error: `You've used all ${ctx.plan.limits.tailorsPerMonth} tailored applications on the ${ctx.plan.name} plan this month.`, upgrade: true }, 402);
  }

  let job = body.job as Job | undefined;
  if (body.jobId) {
    const { data } = await ctx.supabase.from("jobs").select("*").eq("id", body.jobId).maybeSingle();
    if (data) job = data as Job;
  }
  if (!job?.title || !job.company) return json({ error: "Job not found. Refresh your matches and try again." }, 404);

  const { data: resumes } = await ctx.supabase.from("resumes").select("*").eq("user_id", ctx.user.id);
  const list = (resumes as Resume[]) || [];
  const base = list.find((r) => body.roleId && r.target_role_id === body.roleId) || list.find((r) => r.is_master) || list[0];
  if (!base) return json({ error: "Add your resume first — go to Resumes and paste or build it.", needResume: true }, 400);

  const result = await tailorForJob(base.content as ResumeContent, { title: job.title, company: job.company, description: job.description, country: job.country }, ctx.profile.full_name || "");
  const report = scoreResume(result.resume, result.keywords);
  await ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "tailor", meta: { job: job.id, ai: result.ai } });
  return json({ ...result, report, baseResumeId: base.id });
}
