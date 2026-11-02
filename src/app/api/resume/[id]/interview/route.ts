import type { NextRequest } from "next/server";
import { json, loadUserContext } from "@/lib/server-user";
import { runWithAi } from "@/lib/ai-context";
import { buildInterviewKit, type InterviewKit, type Story } from "@/lib/resume/interview";
import { jobDemand, roleDemand } from "@/lib/resume/recruiter-server";
import { skillProof } from "@/lib/resume/recruiter";
import { repairResume } from "@/lib/resume/repair";
import type { ResumeContent } from "@/lib/types";

export const maxDuration = 120;

type Ctx = NonNullable<Awaited<ReturnType<typeof loadUserContext>>>;

async function resolve(ctx: Ctx, id: string, sp: URLSearchParams) {
  const { data: r } = await ctx.supabase.from("resumes").select("id,content,target_role_id").eq("id", id).maybeSingle();
  if (!r) return null;
  const content = repairResume(r.content as ResumeContent);
  const country = ctx.prefs?.countries?.[0] || "US";
  const jobId = sp.get("job");
  if (jobId) {
    const { data: job } = await ctx.supabase.from("jobs").select("id,title,company,description").eq("id", jobId).maybeSingle();
    if (!job) return null;
    return { content, key: `kit:${id}:job:${job.id}`, target: { title: job.title, company: job.company, description: job.description || "" }, demand: jobDemand(job.description || "") };
  }
  const roles = ctx.roles.filter((x) => x.active);
  const role = roles.find((x) => x.id === sp.get("role")) || roles.find((x) => x.id === r.target_role_id) || roles[0];
  if (!role) return null;
  return { content, key: `kit:${id}:role:${role.id}`, target: { title: role.title }, demand: await roleDemand(ctx.supabase, ctx.user.id, role.title, country) };
}

async function load(ctx: Ctx, key: string): Promise<InterviewKit | null> {
  try {
    const { data } = await ctx.supabase.from("resume_insights").select("data").eq("user_id", ctx.user.id).eq("key", key).maybeSingle();
    return (data?.data as InterviewKit) || null;
  } catch {
    return null;
  }
}
async function save(ctx: Ctx, key: string, kit: InterviewKit) {
  try {
    await ctx.supabase.from("resume_insights").upsert({ user_id: ctx.user.id, key, data: kit, updated_at: new Date().toISOString() });
  } catch {
    /* table not there yet */
  }
}

/** The interview kit for a resume and a role (or one job). Built once, then kept with the person's own edits. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const t = await resolve(ctx, id, req.nextUrl.searchParams);
  if (!t) return json({ error: "Not found" }, 404);
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const old = await load(ctx, t.key);
  if (old && !fresh) return json({ kit: old, cached: true });
  const kit = await runWithAi({ userId: ctx.user.id }, () => buildInterviewKit(t.content, t.target, skillProof(t.content, t.demand.skills)));
  // A rebuild keeps every story the person already filled in.
  if (old) kit.stories = kit.stories.map((s) => old.stories.find((o) => o.ref === s.ref && o.ready) || s);
  await save(ctx, t.key, kit);
  return json({ kit, cached: false });
}

/** Save the person's own words for one story. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const t = await resolve(ctx, id, req.nextUrl.searchParams);
  if (!t) return json({ error: "Not found" }, 404);
  const body = (await req.json().catch(() => ({}))) as Partial<Story> & { ref?: string };
  const kit = await load(ctx, t.key);
  if (!kit) return json({ error: "Open the interview kit first." }, 400);
  const clip = (s: unknown, d: string) => (typeof s === "string" ? s.slice(0, 600) : d);
  kit.stories = kit.stories.map((s) => {
    if (s.ref !== body.ref) return s;
    const n = { ...s, situation: clip(body.situation, s.situation), part: clip(body.part, s.part), action: clip(body.action, s.action), result: clip(body.result, s.result) };
    return { ...n, ready: ![n.situation, n.part, n.action, n.result].some((x) => /\[[^\]]+\]/.test(x) || !x.trim()) };
  });
  await save(ctx, t.key, kit);
  return json({ kit });
}
