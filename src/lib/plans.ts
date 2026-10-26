export type PlanId = "free" | "pro" | "autopilot";
export type Interval = "month" | "quarter";
export type Region = "std" | "ppp";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  prices: Record<Region, Record<Interval, number>>; // USD
  features: string[];
  limits: { roles: number; countries: number; tailorsPerMonth: number; autoApplyPerDay: number; trackLimit: number };
  highlight?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "See which live jobs can hire you",
    prices: { std: { month: 0, quarter: 0 }, ppp: { month: 0, quarter: 0 } },
    features: [
      "Live jobs with visa-aware filtering",
      "1 target role, 1 country",
      "1 resume with ATS check",
      "Track up to 25 applications",
    ],
    limits: { roles: 1, countries: 1, tailorsPerMonth: 3, autoApplyPerDay: 0, trackLimit: 25 },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Everything you need to apply well",
    prices: { std: { month: 29, quarter: 69 }, ppp: { month: 12, quarter: 29 } },
    features: [
      "Up to 5 target roles and 4 countries",
      "Tailored resume + cover letter for every job (100/month)",
      "Sponsor checks on every employer",
      "Ask your agent: status, targets, prep",
      "Unlimited application tracking",
    ],
    limits: { roles: 5, countries: 4, tailorsPerMonth: 100, autoApplyPerDay: 0, trackLimit: 100000 },
    highlight: true,
  },
  {
    id: "autopilot",
    name: "Autopilot",
    tagline: "Your agent applies for you",
    prices: { std: { month: 59, quarter: 149 }, ppp: { month: 25, quarter: 59 } },
    features: [
      "Everything in Pro",
      "Unlimited roles and countries",
      "Agent prepares and queues up to 25 applications a day",
      "First-in alerts for target companies",
      "Interview prep for every interview",
    ],
    limits: { roles: 100, countries: 20, tailorsPerMonth: 1000, autoApplyPerDay: 25, trackLimit: 100000 },
  },
];

export const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<PlanId, Plan>;

// Purchasing-power pricing for these residence countries.
export const PPP_COUNTRIES = ["IN", "PK", "BD", "NP", "LK", "NG", "GH", "KE", "PH", "VN", "EG", "ID"];

export function priceKey(plan: PlanId, interval: Interval, region: Region) {
  return `${plan}_${interval}_${region}`;
}
