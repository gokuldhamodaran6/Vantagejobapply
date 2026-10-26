import { json, loadUserContext } from "@/lib/server-user";
import { writeRoleResume } from "@/lib/resume/write-role";

export const maxDuration = 60;

/** Write the resume for every active target role, in the background (used right after onboarding). */
export async function POST() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const roles = ctx.roles.filter((r) => r.active).slice(0, ctx.plan.limits.roles);
  const supabase = ctx.supabase;
  const country = ctx.prefs?.countries?.[0] || "US";
  void (async () => {
    for (const r of roles) {
      try {
        await writeRoleResume(supabase, ctx.user.id, r, country);
      } catch (e) {
        console.error("role resume failed", r.title, e);
      }
    }
  })();
  return json({ ok: true, roles: roles.length });
}
