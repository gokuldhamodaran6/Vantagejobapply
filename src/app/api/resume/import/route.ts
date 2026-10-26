import { structureResume, roleResume } from "@/lib/tailor";
import { extractKeywords, scoreResume } from "@/lib/ats";
import { fileToText } from "@/lib/resume/extract";
import { marketKeywords } from "@/lib/resume/market";
import { json, loadUserContext } from "@/lib/server-user";

export const maxDuration = 120;

/** Import a resume from a PDF/DOCX/TXT upload or pasted text, then write a targeted resume for each role in the background. */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);

  let text = "";
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Choose a file to upload." }, 400);
      if (file.size > 8 * 1024 * 1024) return json({ error: "That file is over 8 MB. Upload a smaller PDF or Word file." }, 400);
      text = await fileToText(file.name, file.type, await file.arrayBuffer());
    } else {
      text = ((await req.json().catch(() => ({}))) as { text?: string }).text || "";
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Couldn't read that file. Try a PDF or Word file, or paste the text." }, 400);
  }
  if (text.trim().length < 80) return json({ error: "We couldn't find enough text in that resume. If it's a scanned image, paste the text instead." }, 400);

  const { content, ai } = await structureResume(text, ctx.profile.full_name || "");
  if (!content.email) content.email = ctx.profile.email;
  if (!content.name) content.name = ctx.profile.full_name || "";

  const { data: existing } = await ctx.supabase.from("resumes").select("id").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
  const row = { content, raw_text: text.slice(0, 60000), ats_score: scoreResume(content).score };
  const master = existing
    ? await ctx.supabase.from("resumes").update(row).eq("id", existing.id).select("id").single()
    : await ctx.supabase.from("resumes").insert({ ...row, user_id: ctx.user.id, name: "Master resume", is_master: true }).select("id").single();
  if (master.error) return json({ error: master.error.message }, 500);

  // Write one targeted resume per role without blocking the response.
  const supabase = ctx.supabase;
  const roles = ctx.roles.filter((r) => r.active).slice(0, ctx.plan.limits.roles);
  void (async () => {
    for (const r of roles) {
      try {
        const kws = await marketKeywords(supabase, r.title, ctx.prefs?.countries?.[0] || "US");
        const out = await roleResume(content, r, kws, ctx.prefs?.countries?.[0] || "US");
        const score = scoreResume(out.content, kws.length ? kws : extractKeywords(r.title)).score;
        const { data: cur } = await supabase.from("resumes").select("id").eq("user_id", ctx.user.id).eq("target_role_id", r.id).not("name", "like", "% — %").maybeSingle();
        const patch = { content: out.content, notes: out.notes, ats_score: score, name: `${r.title} resume` };
        if (cur) await supabase.from("resumes").update(patch).eq("id", cur.id);
        else await supabase.from("resumes").insert({ ...patch, user_id: ctx.user.id, target_role_id: r.id });
      } catch (e) {
        console.error("role resume failed", r.title, e);
      }
    }
  })();

  return json({ ok: true, id: master.data.id, ai, roles: roles.length });
}
