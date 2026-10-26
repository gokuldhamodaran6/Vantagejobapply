import { json, loadUserContext } from "@/lib/server-user";
import { marketKeywords } from "@/lib/resume/market";
import { assessFit, coachQuestions, FIT_VERSION, type Coach, type CoachAnswer } from "@/lib/resume/coach";
import { writeRoleResume } from "@/lib/resume/write-role";
import type { ResumeContent } from "@/lib/types";

export const maxDuration = 120;

/**
 * Role coach. "assess": how the master resume fits a target role, plus the questions a top recruiter would ask.
 * "answer": save the user's answers and rewrite that role's resume using them.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { action?: string; roleId?: string; answers?: CoachAnswer[]; refresh?: boolean };
  const role = ctx.roles.find((r) => r.id === body.roleId) as (typeof ctx.roles)[number] & { coach?: Coach } | undefined;
  if (!role) return json({ error: "Choose one of your target roles." }, 400);
  const coach: Coach = role.coach || {};
  const country = ctx.prefs?.countries?.[0] || "US";

  if (body.action === "assess") {
    if (coach.fit && coach.questions && coach.v === FIT_VERSION && !body.refresh && Date.now() - Date.parse(coach.assessedAt || "") < 7 * 864e5) return json({ coach });
    const { data: master } = await ctx.supabase.from("resumes").select("content").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
    if (!master) return json({ error: "Upload your resume first." }, 400);
    const kws = await marketKeywords(ctx.supabase, role.title, country);
    const fit = assessFit(master.content as ResumeContent, role.title, kws);
    const questions = await coachQuestions(master.content as ResumeContent, role.title, fit);
    const next: Coach = { ...coach, v: FIT_VERSION, fit, questions, assessedAt: new Date().toISOString() };
    await ctx.supabase.from("target_roles").update({ coach: next }).eq("id", role.id);
    return json({ coach: next });
  }

  if (body.action === "answer") {
    const answers = (body.answers || [])
      .map((x) => ({ key: String(x.key || "").slice(0, 40), q: String(x.q || "").slice(0, 400), a: String(x.a || "").slice(0, 2000) }))
      .filter((x) => x.q);
    const next: Coach = { ...coach, answers, answeredAt: new Date().toISOString() };
    const { error } = await ctx.supabase.from("target_roles").update({ coach: next }).eq("id", role.id);
    if (error) return json({ error: error.message }, 500);
    const out = await writeRoleResume(ctx.supabase, ctx.user.id, { ...role, coach: next }, country);
    if ("error" in out) return json({ error: out.error }, 400);
    return json({ coach: next, id: out.id, ai: out.ai, notes: out.notes, score: out.score });
  }
  return json({ error: "Unknown action" }, 400);
}
