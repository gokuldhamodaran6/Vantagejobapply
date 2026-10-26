// Early access: everyone uses Vantage free with generous limits.
// Kept separate from plans.ts so no pricing ever ships to the browser.
export const EARLY_ACCESS = true;

export type Limits = { roles: number; countries: number; tailorsPerMonth: number; autoApplyPerDay: number; trackLimit: number };
export type EffectivePlan = { id: string; name: string; limits: Limits };

export const EARLY_ACCESS_PLAN: EffectivePlan = {
  id: "early",
  name: "Early access",
  // Focused, high-quality volume: what gets interviews, and safe for careers sites.
  limits: { roles: 5, countries: 3, tailorsPerMonth: 300, autoApplyPerDay: 25, trackLimit: 100000 },
};

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
