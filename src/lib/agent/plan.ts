/**
 * How auto-apply chooses jobs — one source of truth shared by the sourcing loop (auto.ts),
 * the "Matched & waiting" pipeline and the targets page, so what the UI explains is what the agent does.
 * Pure: safe in the browser and in tests.
 */
import { ghostRisk } from "@/lib/jobs/ghost";
import { inPreferredPlace } from "@/lib/jobs/places";
import { workModeOk } from "@/lib/jobs/match";
import { normCompany } from "@/lib/jobs/signals";
import type { Job, MatchResult, TargetPrefs } from "@/lib/types";

/** A job must fit a target at least this well, and score at least this, before the agent spends an application on it. */
export const AUTO_MIN_FIT = 0.55;
export const AUTO_MIN_SCORE = 58;
/** Live jobs shows anything from the last 60 days; the agent only applies to fresher posts (target_prefs.max_days_old). */
export const LIVE_MAX_DAYS = 60;
export const DEFAULT_FRESH_DAYS = 14;

export const PRIORITIES = [
  { value: 1, label: "Top priority", short: "Top", weight: 3 },
  { value: 2, label: "High", short: "High", weight: 2 },
  { value: 3, label: "Normal", short: "Normal", weight: 1 },
] as const;

export function priorityMeta(p: number | null | undefined) {
  return PRIORITIES.find((x) => x.value === p) || PRIORITIES[1];
}

/** Queue position for an auto-sourced task: important ones first, then by the target's priority (lower runs sooner). */
export function taskPriority(important: boolean, rolePriority: number | null | undefined) {
  if (important) return 3;
  return 3 + priorityMeta(rolePriority).value; // top → 4, high → 5, normal → 6
}

export type SkipReason =
  | "Visa or eligibility rules"
  | "More senior than your levels"
  | "Not a close enough match"
  | "Outside your locations"
  | "Not your work arrangement"
  | "Likely ghost job"
  | "Older than your freshness setting"
  | "Careers site not verified yet";

/** Why the agent would not apply to this job on its own (null = it would). Mirrors the checks in autoSource. */
export function autoSkipReason(
  job: Job & { first_seen_at?: string | null },
  m: MatchResult,
  prefs: TargetPrefs | null,
  opts: { vetted: boolean; now?: number },
): SkipReason | null {
  const now = opts.now ?? Date.now();
  if (!m.eligible) return "Visa or eligibility rules";
  // The agent sticks to the levels you picked; a step up is yours to choose in Live jobs.
  if (m.tooSenior || m.stretchUp) return "More senior than your levels";
  if ((m.roleFit ?? 0) < AUTO_MIN_FIT || m.score < AUTO_MIN_SCORE) return "Not a close enough match";
  if (!inPreferredPlace(job, prefs)) return "Outside your locations";
  if (!workModeOk(job, prefs)) return "Not your work arrangement";
  if (ghostRisk(job)?.level === "high") return "Likely ghost job";
  const posted = Date.parse(job.posted_at || "") || Date.parse(job.first_seen_at || "") || 0;
  if (posted && now - posted > (prefs?.max_days_old || DEFAULT_FRESH_DAYS) * 864e5) return "Older than your freshness setting";
  if (!opts.vetted) return "Careers site not verified yet";
  return null;
}

/**
 * Order candidates so every active target gets its turn, weighted by priority: per round a Top-priority target
 * gets 3 picks, High 2, Normal 1 — best score first within each target. Candidates without a target go last.
 */
export function interleaveByPriority<T extends { roleId?: string | null; score: number }>(cands: T[], roles: { id: string; priority: number }[]): T[] {
  const order = [...roles].sort((a, b) => priorityMeta(a.priority).value - priorityMeta(b.priority).value);
  const queues = new Map<string, T[]>(order.map((r) => [r.id, []]));
  const rest: T[] = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score)) {
    const q = c.roleId ? queues.get(c.roleId) : undefined;
    if (q) q.push(c);
    else rest.push(c);
  }
  const out: T[] = [];
  while ([...queues.values()].some((q) => q.length)) {
    for (const r of order) {
      const q = queues.get(r.id)!;
      out.push(...q.splice(0, priorityMeta(r.priority).weight));
    }
  }
  return [...out, ...rest];
}

/** The nominal split of a daily limit across active targets by priority weight (what each gets when all have matches). */
export function shareOfLimit(roles: { id: string; priority: number; active: boolean }[], limit: number): Record<string, number> {
  const act = roles.filter((r) => r.active);
  const total = act.reduce((a, r) => a + priorityMeta(r.priority).weight, 0);
  const out: Record<string, number> = {};
  if (!total || limit <= 0) return out;
  // Largest-remainder rounding so the shares add up to the limit exactly.
  const raw = act.map((r) => ({ id: r.id, v: (limit * priorityMeta(r.priority).weight) / total }));
  raw.forEach((x) => (out[x.id] = Math.floor(x.v)));
  let left = limit - raw.reduce((a, x) => a + Math.floor(x.v), 0);
  for (const x of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left <= 0) break;
    out[x.id] += 1;
    left -= 1;
  }
  return out;
}

/** Start of "today" for the daily limit: the database counts from midnight UTC. */
export function limitDayStart(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Same keys the database uses (private.co_key / private.title_key), so a repost of a job already sent is skipped. */
export const roleKey = (company: string, title: string) => {
  const co = normCompany(company).replace(/^\d+ /, "").trim();
  const t = String(title || "").toLowerCase()
    .replace(/^\s*apply (to|for)\s+/, "")
    .replace(/\s*[-–|]\s*page \d+( of \d+)?\s*$/, "")
    .replace(/( at [^|]*)?\s*\|\s*(linkedin|indeed)[^|]*$/, "")
    .replace(/[^a-z0-9+#]+/g, " ").trim();
  return `${co}|${t}`;
};
