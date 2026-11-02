import type { NextRequest } from "next/server";
import { json, loadUserContext } from "@/lib/server-user";

/** Earlier versions of a resume (saved automatically on every change), and restoring one. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const { data, error } = await ctx.supabase.from("resume_versions").select("id,created_at,reason,content").eq("resume_id", id).order("created_at", { ascending: false }).limit(20);
  if (error) return json({ versions: [] });
  return json({
    versions: (data || []).map((v) => {
      const c = v.content as { experience?: { bullets?: string[] }[]; projects?: unknown[] };
      return { id: v.id, at: v.created_at, reason: v.reason, roles: c.experience?.length || 0, bullets: (c.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0), projects: c.projects?.length || 0 };
    }),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string };
  const { data: v } = await ctx.supabase.from("resume_versions").select("content").eq("id", versionId || "").eq("resume_id", id).maybeSingle();
  if (!v) return json({ error: "That version is gone." }, 404);
  // The current content is saved as a version by the database trigger before it is replaced.
  const { error } = await ctx.supabase.from("resumes").update({ content: v.content, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
