import type { LetterTone, ResumeStyle } from "@/lib/types";

export type ArmStats = Record<string, { sent: number; interviews: number }>;

const WIN = new Set(["interview", "offer"]);
const SENT = new Set(["applied", "in_review", "interview", "offer", "rejected"]);

export function styleStats(apps: { status: string; resume_style: string | null; letter_tone: string | null }[]) {
  const styles: ArmStats = {};
  const tones: ArmStats = {};
  for (const a of apps) {
    if (!SENT.has(a.status)) continue;
    for (const [bucket, key] of [[styles, a.resume_style], [tones, a.letter_tone]] as const) {
      if (!key) continue;
      bucket[key] ||= { sent: 0, interviews: 0 };
      bucket[key].sent += 1;
      if (WIN.has(a.status)) bucket[key].interviews += 1;
    }
  }
  return { styles, tones };
}

// Gamma(k,1) via Marsaglia–Tsang, for Beta sampling.
function gamma(k: number): number {
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = Math.random() || 1e-9;
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (a: number, b: number) => {
  const x = gamma(a);
  return x / (x + gamma(b));
};

/**
 * Thompson sampling: mostly use what's winning interviews for this user, keep testing the others a little.
 * Prior: ~8% interview rate, with a small head start for the user's chosen default.
 */
export function pickArm<T extends string>(stats: ArmStats, arms: T[], preferred: T): T {
  let best = preferred;
  let bestDraw = -1;
  for (const arm of arms) {
    const s = stats[arm] || { sent: 0, interviews: 0 };
    const a = 0.8 + s.interviews + (arm === preferred ? 0.4 : 0);
    const b = 9.2 + Math.max(0, s.sent - s.interviews);
    const draw = beta(a, b);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = arm;
    }
  }
  return best;
}

export const STYLE_ARMS: ResumeStyle[] = ["classic", "modern", "compact", "executive"];
export const TONE_ARMS: LetterTone[] = ["confident", "warm", "bold", "formal"];

export function rate(s?: { sent: number; interviews: number }) {
  if (!s || !s.sent) return null;
  return Math.round((s.interviews / s.sent) * 100);
}
