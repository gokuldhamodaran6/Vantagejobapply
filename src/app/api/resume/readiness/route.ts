import { json, loadUserContext } from "@/lib/server-user";
import { atsReadout, roleDemand } from "@/lib/resume/recruiter-server";
import { gradeLines, skillLabel, skillProof, titleFound } from "@/lib/resume/recruiter";
import { repairResume } from "@/lib/resume/repair";
import type { InterviewKit } from "@/lib/resume/interview";
import type { ResumeContent, ResumeStyle } from "@/lib/types";

export const maxDuration = 60;

/** The four checks on the Resumes page, each a count of something real. */
export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { data: m } = await ctx.supabase.from("resumes").select("id,content,style").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
  if (!m) return json({ master: null });
  const master = repairResume(m.content as ResumeContent);
  const country = ctx.prefs?.countries?.[0] || "US";
  const roles = ctx.roles.filter((r) => r.active);

  const [parse, roleRows, versions, kits] = await Promise.all([
    atsReadout(master, (m.style || "classic") as ResumeStyle, country),
    Promise.all(
      roles.map(async (role) => {
        const { data: rr } = await ctx.supabase.from("resumes").select("content").eq("user_id", ctx.user.id).eq("target_role_id", role.id).eq("kind", "role").maybeSingle();
        const c = rr?.content ? repairResume(rr.content as ResumeContent) : master;
        const d = await roleDemand(ctx.supabase, ctx.user.id, role.title, country);
        const proof = skillProof(c, d.skills);
        const t = titleFound(c, role.title);
        const missing = proof.filter((p) => p.status === "missing");
        return {
          id: role.id,
          title: role.title,
          postings: d.postings,
          skills: proof.length,
          have: proof.filter((p) => p.status !== "missing").length,
          proven: proof.filter((p) => p.status === "proven").length,
          missing: missing.slice(0, 2).map((p) => ({ skill: skillLabel(p.skill), share: p.share })),
          titleFound: t.found,
          titleVia: t.via,
          found: d.postings > 0 && t.found && missing.length <= Math.max(2, Math.round(proof.length * 0.25)),
        };
      }),
    ),
    ctx.supabase.from("resume_versions").select("id,created_at,reason").eq("resume_id", m.id).order("created_at", { ascending: false }).limit(10).then((r) => r.data || [], () => []),
    ctx.supabase.from("resume_insights").select("key,data").eq("user_id", ctx.user.id).like("key", "kit:%").then((r) => r.data || [], () => []),
  ]);
  const lines = gradeLines(master).filter((l) => l.section === "experience");
  const fixes = gradeLines(master).filter((l) => l.grade === "fix" && l.section === "experience").slice(0, 3);
  const kitList = (kits as { key: string; data: InterviewKit }[]).map((k) => k.data).filter((k) => k?.stories?.length);
  const best = kitList.sort((a, b) => b.stories.filter((s) => s.ready).length - a.stories.filter((s) => s.ready).length)[0];
  return json({
    master: { id: m.id },
    parse: { ok: parse.filter((p) => p.ok).length, total: parse.length, bad: parse.filter((p) => !p.ok).map((p) => p.field) },
    roles: roleRows,
    lines: { strong: lines.filter((l) => l.grade === "strong").length, total: lines.length },
    fixes: fixes.map((f) => ({ role: f.role, text: f.text, tip: f.tip, tags: f.tags.filter((t) => !t.good).map((t) => t.t) })),
    stories: best ? { ready: best.stories.filter((s) => s.ready).length, total: best.stories.length } : null,
    versions,
  });
}
