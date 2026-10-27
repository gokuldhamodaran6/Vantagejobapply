import type { NextRequest } from "next/server";
import { searchForUser } from "@/lib/jobs/engine";
import { json, loadUserContext } from "@/lib/server-user";
import { keyOf, memo } from "@/lib/memo";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const ctx = await loadUserContext();
  const ctxMs = Date.now() - t0;
  if (!ctx) return json({ error: "Log in to search jobs." }, 401);

  const sp = req.nextUrl.searchParams;
  const allowedCountries = (ctx.prefs?.countries || []).slice(0, ctx.plan.limits.countries);
  const country = (sp.get("country") || allowedCountries[0] || "US").toUpperCase();

  const started = Date.now();
  try {
    const input = {
        country,
        q: sp.get("q")?.slice(0, 120) || undefined,
        roleId: sp.get("role") || undefined,
        city: sp.get("city") || undefined,
        remoteOnly: sp.get("remote") === "1",
        maxDaysOld: sp.get("days") ? parseInt(sp.get("days")!, 10) : undefined,
        showBlocked: sp.get("blocked") === "1",
      };
    // The same search by the same person (same targets and settings) is reused for 2 minutes; Refresh asks afresh.
    const run = () => searchForUser(ctx.supabase, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, roleLimit: ctx.plan.limits.roles }, input);
    const out = sp.get("fresh") === "1" ? await run() : await memo(keyOf("jobs", ctx.user.id, input, ctx.roles, ctx.prefs, ctx.auth), 2 * 60_000, run);
    ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "job_search", meta: { country, n: out.results.length, ms: Date.now() - started } }).then(() => {});
    return json({ ...out, country, tookMs: Date.now() - started, ctxMs });
  } catch (e) {
    console.error("job search failed", e);
    return json({ error: "Job search is temporarily unavailable. Try again in a minute." }, 500);
  }
}
