import { json, loadUserContext } from "@/lib/server-user";
import { writeRoleResume } from "@/lib/resume/write-role";

export const maxDuration = 120;

/** Create (or rewrite) the targeted resume for one of the user's roles. */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { roleId } = (await req.json().catch(() => ({}))) as { roleId?: string };
  const role = ctx.roles.find((r) => r.id === roleId);
  if (!role) return json({ error: "Choose one of your target roles." }, 400);
  const out = await writeRoleResume(ctx.supabase, ctx.user.id, role, ctx.prefs?.countries?.[0] || "US");
  if ("error" in out) return json({ error: out.error }, 400);
  return json({ id: out.id, ai: out.ai, notes: out.notes, score: out.score, keywords: out.keywords });
}
