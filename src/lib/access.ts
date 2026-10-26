import { normCompany as normCompanyName } from "@/lib/jobs/signals";
// Early access: everyone uses Vantage free with generous limits.
// Kept separate from plans.ts so no pricing ever ships to the browser.
export const EARLY_ACCESS = true;

export type Limits = { roles: number; countries: number; tailorsPerMonth: number; autoApplyPerDay: number; trackLimit: number };
export type EffectivePlan = { id: string; name: string; limits: Limits };

export const EARLY_ACCESS_PLAN: EffectivePlan = {
  id: "early",
  name: "Early access",
  // Focused, high-quality volume: what gets interviews, and safe for careers sites.
  limits: { roles: 5, countries: 3, tailorsPerMonth: 300, autoApplyPerDay: 200, trackLimit: 100000 },
};

/**
 * Daily applications by the agent. Fewer, tailored applications get more interviews and keep careers sites happy,
 * so the default is 20; up to 200 only when the person explicitly opts in to high volume.
 */
export const DEFAULT_DAILY = 20;
export const HIGH_VOLUME_MAX = 200;
/** At most this many applications to the same employer in 30 days (the agent never floods one company). */
export const PER_EMPLOYER_30D = 3;

/** How many applications the person's agent sent (or has lined up) per employer in the last 30 days. */
export async function recentByEmployer(supabase: { from: (t: string) => any }): Promise<Map<string, number>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await supabase.from("agent_tasks").select("job,status").gte("created_at", since)
    .in("status", ["submitted", "queued", "running", "waiting_code", "needs_human", "needs_user", "awaiting_approval"]).limit(5000);
  const m = new Map<string, number>();
  for (const t of (data as { job: { company?: string } }[] | null) || []) {
    const co = normCompanyName(t.job?.company || "");
    if (co) m.set(co, (m.get(co) || 0) + 1);
  }
  return m;
}

export function dailyLimit(profile: { daily_limit?: number | null; high_volume_ok?: boolean | null } | null | undefined, plan: EffectivePlan): number {
  const cap = profile?.high_volume_ok ? Math.min(HIGH_VOLUME_MAX, plan.limits.autoApplyPerDay) : Math.min(DEFAULT_DAILY, plan.limits.autoApplyPerDay);
  const chosen = typeof profile?.daily_limit === "number" && Number.isFinite(profile.daily_limit) ? profile.daily_limit : DEFAULT_DAILY;
  return Math.max(0, Math.min(chosen, cap));
}

/** The owner and admins test without limits. */
export const OWNER_PLAN: EffectivePlan = {
  id: "owner",
  name: "Owner · unlimited",
  limits: { roles: 100, countries: 20, tailorsPerMonth: 1_000_000, autoApplyPerDay: 500, trackLimit: 1_000_000 },
};

/** Limits for the current user: admins are unlimited; everyone else gets early-access limits. */
export function effectivePlan(_planId?: string | null, role?: string | null): EffectivePlan {
  void _planId;
  return role === "admin" ? OWNER_PLAN : EARLY_ACCESS_PLAN;
}
