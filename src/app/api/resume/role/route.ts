import { roleResume } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats";
import { marketKeywords } from "@/lib/resume/market";
import { json, loadUserContext } from "@/lib/server-user";
import type { ResumeContent } from "@/lib/types";

export const maxDuration = 120;

/** Create (or rewrite) the targeted resume for one of the user's roles. */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { roleId } = (await req.json().catch(() => ({}))) as { roleId?: string };
  const role = ctx.roles.find((r) => r.id === roleId);
  if (!role) return json({ error: "Choose one of your target roles." }, 400);
  const { data: master } = await ctx.supabase.from("resumes").select("content").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
  if (!master) return json({ error: "Upload your resume first." }, 400);
  const country = ctx.prefs?.countries?.[0] || "US";
  const kws = await marketKeywords(ctx.supabase, role.title, country);
  const out = await roleResume(master.content as ResumeContent, role, kws, country);
  const report = scoreResume(out.content, kws);
  const { data: cur } = await ctx.supabase.from("resumes").select("id").eq("user_id", ctx.user.id).eq("target_role_id", role.id).not("name", "like", "% — %").maybeSingle();
  const patch = { content: out.content, notes: out.notes, ats_score: report.score, name: `${role.title} resume` };
  const res = cur
    ? await ctx.supabase.from("resumes").update(patch).eq("id", cur.id).select("id").single()
    : await ctx.supabase.from("resumes").insert({ ...patch, user_id: ctx.user.id, target_role_id: role.id }).select("id").single();
  if (res.error) return json({ error: res.error.message }, 500);
  return json({ id: res.data.id, ai: out.ai, notes: out.notes, score: report.score, keywords: kws });
}
