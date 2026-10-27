import { json, loadUserContext } from "@/lib/server-user";
import { suggestRoles } from "@/lib/resume/suggest";
import { runWithAi } from "@/lib/ai-context";
import type { ResumeContent } from "@/lib/types";

export const maxDuration = 60;

/** Target roles read from the user's master resume, plus details to prefill their profile. */
export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { data } = await ctx.supabase.from("resumes").select("content").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
  if (!data) return json({ error: "Upload your resume first." }, 400);
  const r = data.content as ResumeContent;
  const roles = await runWithAi({ userId: ctx.user.id }, () => suggestRoles(r));
  return json({
    roles,
    profile: { name: r.name || "", phone: r.phone || "", linkedin: (r.links || []).find((l) => /linkedin/i.test(l)) || "", location: r.location || "", headline: r.headline || r.experience?.[0]?.title || "" },
  });
}
