/**
 * When auto-apply runs. Pure: shared by the agent run (server), Settings and the agent page.
 * No schedule = through the day, every 10 minutes (the agent run's own pace).
 */
export type AutoSchedule = { tz?: string; times?: string[]; quiet?: { from: number; to: number } | null } | null;

/** The agent run happens every 10 minutes, so a set time "fires" in the run that falls in its 10-minute window. */
export const RUN_EVERY_MIN = 10;

const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export function cleanSchedule(s: AutoSchedule): AutoSchedule {
  if (!s) return null;
  const times = [...new Set((s.times || []).filter(valid))].sort().slice(0, 6);
  const quiet = s.quiet && Number.isInteger(s.quiet.from) && Number.isInteger(s.quiet.to) && s.quiet.from !== s.quiet.to ? { from: s.quiet.from % 24, to: s.quiet.to % 24 } : null;
  if (!times.length && !quiet) return null;
  return { tz: s.tz || "UTC", times, quiet };
}

/** Minutes since midnight and the date, in the person's own time zone. */
export function localClock(now: number, tz = "UTC") {
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  } catch {
    return localClock(now, "UTC");
  }
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function inQuietHours(s: AutoSchedule, now: number) {
  if (!s?.quiet) return false;
  const h = Math.floor(localClock(now, s.tz).minutes / 60);
  const { from, to } = s.quiet;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/**
 * Should this agent run look for new jobs for this person, and how many runs are left today (to spread the limit)?
 * Set times: only in the run whose window holds a time. No times: every run, outside quiet hours.
 */
export function runNow(s: AutoSchedule, now: number): { run: boolean; runsLeft: number } {
  const sc = cleanSchedule(s);
  if (!sc) return { run: true, runsLeft: 1 };
  if (inQuietHours(sc, now)) return { run: false, runsLeft: 0 };
  if (!sc.times?.length) return { run: true, runsLeft: 1 };
  const m = localClock(now, sc.tz).minutes;
  const due = sc.times.some((t) => m >= toMin(t) && m < toMin(t) + RUN_EVERY_MIN);
  const left = sc.times.filter((t) => toMin(t) + RUN_EVERY_MIN > m).length;
  return { run: due, runsLeft: Math.max(1, left) };
}

/** Today's runs for the agent page: done, next and later. */
export function todaysRuns(s: AutoSchedule, now: number): { time: string; label: string; state: "done" | "next" | "later" }[] {
  const sc = cleanSchedule(s);
  if (!sc?.times?.length) return [];
  const m = localClock(now, sc.tz).minutes;
  let nextSet = false;
  return sc.times.map((t) => {
    const end = toMin(t) + RUN_EVERY_MIN;
    const state = end <= m ? "done" : nextSet ? "later" : ((nextSet = true), "next");
    return { time: t, label: label12(t), state };
  });
}

export function label12(t: string) {
  const h = Number(t.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
}
