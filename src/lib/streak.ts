/**
 * Daily application streak (Duolingo-style). A day counts when the person applied to at least one job that day
 * (applications.applied_at, any source: the Chrome extension, added by hand, or found in their job email).
 * Days are the person's own local days (their browser's time zone). Today not done yet does NOT break the streak
 * until the day is over — it's "at risk" instead ("Apply today to keep your 5-day streak").
 */
export type Streak = {
  /** Consecutive days up to today (or up to yesterday when today isn't done yet). */
  current: number;
  /** Longest run in the data given. */
  best: number;
  todayDone: boolean;
  /** The streak is alive but today still needs an application. */
  atRisk: boolean;
  /** The last 7 local days, oldest first, ending today. */
  last7: boolean[];
  /** "YYYY-MM-DD" for each of `last7`. */
  last7Days: string[];
};

const keyFmt = new Map<string, Intl.DateTimeFormat>();

/** Local "YYYY-MM-DD" of an instant in `tz` (the system zone when tz is empty). */
export function localDayKey(d: Date, tz?: string | null) {
  const zone = tz || "";
  let f = keyFmt.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: zone || undefined, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    keyFmt.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Day-number arithmetic on "YYYY-MM-DD" keys (UTC under the hood, so DST never skips a day). */
const toNum = (k: string) => Math.round(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 864e5);
const fromNum = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);

export function computeStreak(days: (Date | string | null | undefined)[], today: Date = new Date(), tz?: string | null): Streak {
  const todayN = toNum(localDayKey(today, tz));
  const set = new Set<number>();
  for (const d of days) {
    if (!d) continue;
    const at = d instanceof Date ? d : new Date(d);
    if (isNaN(at.getTime())) continue;
    const n = toNum(localDayKey(at, tz));
    if (n <= todayN) set.add(n); // a clock a little ahead never counts as "tomorrow"
  }
  const todayDone = set.has(todayN);
  let current = 0;
  for (let n = todayDone ? todayN : todayN - 1; set.has(n); n--) current++;

  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const n of [...set].sort((a, b) => a - b)) {
    run = n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }

  const last7Days = Array.from({ length: 7 }, (_, i) => fromNum(todayN - 6 + i));
  return {
    current,
    best: Math.max(best, current),
    todayDone,
    atRisk: !todayDone && current > 0,
    last7: last7Days.map((k) => set.has(toNum(k))),
    last7Days,
  };
}

/** One-line nudge under the streak. */
export function streakNudge(s: Streak) {
  const days = (n: number) => `${n}-day streak`;
  if (s.todayDone) return s.current > 1 ? `Done for today — ${days(s.current)}. See you tomorrow.` : "Done for today. Apply again tomorrow to start a streak.";
  if (s.atRisk) return `Apply today to keep your ${days(s.current)}.`;
  if (s.best > 1) return `Apply to one job today to start a new streak. Your best is ${s.best} days.`;
  return "Apply to one job today to start a streak.";
}

/** Weekday letter (S M T W T F S) of a "YYYY-MM-DD" key. */
export const weekdayLetter = (k: string) => "SMTWTFS"[new Date(`${k}T12:00:00Z`).getUTCDay()];
