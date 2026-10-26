import { structureResume } from "@/lib/tailor";
import { extractKeywords, scoreResume } from "@/lib/ats";
import { json, loadUserContext } from "@/lib/server-user";

export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || text.trim().length < 40) return json({ error: "Paste the full text of your resume." }, 400);

  const content = await structureResume(text, ctx.profile.full_name || "");
  if (!content.email) content.email = ctx.profile.email;
  const master = await ctx.supabase
    .from("resumes")
    .insert({ user_id: ctx.user.id, name: "Master resume", is_master: true, content, ats_score: scoreResume(content).score })
    .select()
    .single();
  if (master.error) return json({ error: master.error.message }, 500);

  // One starting resume per target role.
  const roleRows = ctx.roles.slice(0, ctx.plan.limits.roles).map((r) => {
    const kws = extractKeywords(`${r.title} ${r.keywords.join(" ")}`);
    return { user_id: ctx.user.id, target_role_id: r.id, name: `${r.title} resume`, content, ats_score: scoreResume(content, kws).score };
  });
  if (roleRows.length) await ctx.supabase.from("resumes").insert(roleRows);
  return json({ ok: true, id: master.data.id });
}
