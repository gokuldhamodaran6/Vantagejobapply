import { json, loadUserContext } from "@/lib/server-user";
import { structureResume } from "@/lib/tailor";
import { scoreResume } from "@/lib/ats";
import { resumeIssues } from "@/lib/resume/health";
import { writeRoleResume } from "@/lib/resume/write-role";
import { aiConfigured } from "@/lib/ai";
import { runWithAi } from "@/lib/ai-context";
import type { ResumeContent } from "@/lib/types";

export const maxDuration = 120;

/** Re-read the original resume file with AI for a clean master, then rewrite every role resume from it. */
export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { data: master } = await ctx.supabase.from("resumes").select("id,raw_text,content").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
  if (!master) return json({ error: "Upload your resume first." }, 400);
  let content = master.content as ResumeContent;
  let rebuilt = false;
  if (master.raw_text && aiConfigured()) {
    const out = await runWithAi({ userId: ctx.user.id }, () => structureResume(master.raw_text, ctx.profile.full_name || ""));
    // Only replace the master if the AI read is at least as complete as what we have.
    if (out.ai && (out.content.experience?.length || 0) >= Math.max(1, (content.experience?.length || 0) - 1)) {
      content = out.content;
      rebuilt = true;
      await ctx.supabase.from("resumes").update({ content, ats_score: scoreResume(content).score, updated_at: new Date().toISOString() }).eq("id", master.id);
    }
  }
  const roles = ctx.roles.filter((r) => r.active).slice(0, ctx.plan.limits.roles);
  const supabase = ctx.supabase;
  void (async () => {
    for (const r of roles) {
      try {
        await writeRoleResume(supabase, ctx.user.id, r, ctx.prefs?.countries?.[0] || "US");
      } catch (e) {
        console.error("role resume failed", r.title, e);
      }
    }
  })();
  return json({ ok: true, rebuilt, issues: resumeIssues(content, ctx.profile.full_name || ""), roles: roles.length });
}
