// Early access: everyone uses Vantage free with generous limits.
// Kept separate from plans.ts so no pricing ever ships to the browser.
export const EARLY_ACCESS = true;

export type Limits = { roles: number; countries: number; tailorsPerMonth: number; autoApplyPerDay: number; trackLimit: number };
export type EffectivePlan = { id: string; name: string; limits: Limits };

export const EARLY_ACCESS_PLAN: EffectivePlan = {
  id: "early",
  name: "Early access",
  limits: { roles: 10, countries: 6, tailorsPerMonth: 300, autoApplyPerDay: 25, trackLimit: 100000 },
};

/** Limits for the current user. During early access everyone gets the same. */
export function effectivePlan(_planId?: string | null): EffectivePlan {
  void _planId;
  return EARLY_ACCESS_PLAN;
}
