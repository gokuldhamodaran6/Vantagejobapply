import type { NextRequest } from "next/server";
import { searchForUser } from "@/lib/jobs/engine";
import { json, loadUserContext } from "@/lib/server-user";

export async function GET(req: NextRequest) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in to search jobs." }, 401);

  const sp = req.nextUrl.searchParams;
  const allowedCountries = (ctx.prefs?.countries || []).slice(0, ctx.plan.limits.countries);
  const country = (sp.get("country") || allowedCountries[0] || "US").toUpperCase();
  if (allowedCountries.length && !allowedCountries.includes(country) && ctx.plan.id === "free") {
    return json({ error: "Your Free plan searches your first target country. Upgrade to search more countries.", upgrade: true }, 402);
  }

  const started = Date.now();
  try {
    const out = await searchForUser(
      ctx.supabase,
      { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, roleLimit: ctx.plan.limits.roles },
      {
        country,
        q: sp.get("q")?.slice(0, 120) || undefined,
        roleId: sp.get("role") || undefined,
        city: sp.get("city") || undefined,
        remoteOnly: sp.get("remote") === "1",
        maxDaysOld: sp.get("days") ? parseInt(sp.get("days")!, 10) : undefined,
        showBlocked: sp.get("blocked") === "1",
      },
    );
    ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "job_search", meta: { country, n: out.results.length, ms: Date.now() - started } }).then(() => {});
    return json({ ...out, country, tookMs: Date.now() - started });
  } catch (e) {
    console.error("job search failed", e);
    return json({ error: "Job search is temporarily unavailable. Try again in a minute." }, 500);
  }
}
