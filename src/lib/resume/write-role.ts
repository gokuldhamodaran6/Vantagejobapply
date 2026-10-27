import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { roleResume } from "@/lib/tailor";
import { runWithAi } from "@/lib/ai-context";
import { scoreResume } from "@/lib/ats";
import { marketKeywords } from "@/lib/resume/market";
import { assessFit, coachFacts, FIT_VERSION, type Coach } from "@/lib/resume/coach";
import type { ResumeContent, TargetRole } from "@/lib/types";

/** Write (or rewrite) the one resume for a target role, using what the user told the role coach. */
export async function writeRoleResume(supabase: SupabaseClient, userId: string, role: TargetRole & { coach?: Coach }, country = "US") {
  const { data: master } = await supabase.from("resumes").select("content").eq("user_id", userId).eq("is_master", true).maybeSingle();
  if (!master) return { error: "Upload your resume first." } as const;
  const kws = await marketKeywords(supabase, role.title, country);
  const coach: Coach = { ...(role.coach || {}) };
  // Know how this role fits before writing: a career move is positioned differently from a strong fit.
  if (!coach.fit) {
    coach.fit = assessFit(master.content as ResumeContent, role.title, kws);
    coach.v = FIT_VERSION;
    await supabase.from("target_roles").update({ coach }).eq("id", role.id);
  }
  const courses = (coach.answers || [])
    .filter((x) => /course|certif|bootcamp|training/i.test(`${x.key} ${x.q}`))
    .flatMap((x) => x.a.split(/\n|;|•/).map((t) => t.trim()).filter((t) => t.length > 4 && t.length < 140))
    .slice(0, 6);
  const out = await runWithAi({ userId }, () => roleResume(master.content as ResumeContent, role, kws, country, coach.answers?.length ? { facts: coachFacts(coach.answers), level: coach.fit?.level, courses } : coach.fit ? { facts: "", level: coach.fit.level } : undefined));
  const report = scoreResume(out.content, kws);
  const { data: cur } = await supabase.from("resumes").select("id").eq("user_id", userId).eq("target_role_id", role.id).eq("kind", "role").maybeSingle();
  const patch = { content: out.content, notes: out.notes, ats_score: report.score, name: `${role.title} resume`, kind: "role", updated_at: new Date().toISOString() };
  const res = cur
    ? await supabase.from("resumes").update(patch).eq("id", cur.id).select("id").single()
    : await supabase.from("resumes").insert({ ...patch, user_id: userId, target_role_id: role.id }).select("id").single();
  if (res.error) return { error: res.error.message } as const;
  return { id: res.data.id as string, ai: out.ai, notes: out.notes, score: report.score, keywords: kws, missing: report };
}
