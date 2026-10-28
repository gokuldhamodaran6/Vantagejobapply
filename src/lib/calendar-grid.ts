/**
 * Pure date helpers for the Interviews calendar (Day / Week / Month / Agenda, like Google Calendar).
 * Everything works in the viewer's local time; weeks start on Sunday (US Google Calendar default).
 */
export type CalView = "day" | "week" | "month" | "agenda";

export const DAY_MIN = 24 * 60;
/** How many days the Agenda view shows at a time. */
export const AGENDA_DAYS = 30;
/** Shortest visual height of an event in the time grid, also used to decide what overlaps. */
export const MIN_BLOCK_MIN = 20;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Local "YYYY-MM-DD" (handy as a React key or map key). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The Sunday (or `weekStartsOn`) that starts the week containing `d`, at midnight. */
export function startOfWeek(d: Date, weekStartsOn = 0) {
  const s = startOfDay(d);
  const lead = (s.getDay() - weekStartsOn + 7) % 7;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - lead);
}

/** Six full weeks (42 days) covering the month of `anchor`, starting on the Sunday on/before the 1st. */
export function monthGrid(anchor: Date, weekStartsOn = 0) {
  const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** The days a time-grid view shows: one for Day, seven (Sun–Sat) for Week. */
export function gridDays(view: "day" | "week", anchor: Date, weekStartsOn = 0) {
  if (view === "day") return [startOfDay(anchor)];
  const s = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i));
}

/** Visible range of a view: [start, end) at local midnights. */
export function rangeFor(view: CalView, anchor: Date, weekStartsOn = 0): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor, weekStartsOn);
    return { start, end: addDays(start, 7) };
  }
  if (view === "month") {
    return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, AGENDA_DAYS) };
}

/** The anchor after pressing ‹ (dir -1) or › (dir +1). */
export function shiftAnchor(view: CalView, anchor: Date, dir: 1 | -1) {
  if (view === "day") return addDays(startOfDay(anchor), dir);
  if (view === "week") return addDays(startOfDay(anchor), 7 * dir);
  if (view === "agenda") return addDays(startOfDay(anchor), AGENDA_DAYS * dir);
  // Month: keep the day of month where possible (Jan 31 → Feb 28), like Google.
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + dir;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(anchor.getDate(), last));
}

/** Toolbar title: "October 2026", "Oct 26 – Nov 1, 2026", "Oct 4 – 10, 2026", "Wednesday, October 28, 2026". */
export function rangeTitle(view: CalView, anchor: Date, weekStartsOn = 0) {
  if (view === "month") return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  if (view === "day") return `${WEEKDAYS[anchor.getDay()]}, ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}, ${anchor.getFullYear()}`;
  const { start, end } = rangeFor(view, anchor, weekStartsOn);
  return spanTitle(start, addDays(end, -1));
}

/** "Oct 26 – Nov 1, 2026" for an inclusive span of days. */
export function spanTitle(a: Date, b: Date) {
  if (a.getFullYear() !== b.getFullYear()) return `${MON[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${MON[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${MON[a.getMonth()]} ${a.getDate()} – ${MON[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${MON[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
}

/** Minutes since local midnight (wall clock, so DST days still line up with the hour labels). */
export const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** An event lasting a full day or more (e.g. an assessment deadline) goes in the all-day row. */
export const isAllDay = (minutes: number) => minutes >= DAY_MIN;

export type Span = { id: string; start: Date; end: Date };

/** Does [start, end) touch the local day `day`? Zero-length events count on the day they start. */
export function overlapsDay(e: Span, day: Date) {
  const s = startOfDay(day).getTime();
  const n = addDays(startOfDay(day), 1).getTime();
  const a = e.start.getTime();
  const b = Math.max(e.end.getTime(), a + 1);
  return a < n && b > s;
}

export type Placed = { id: string; top: number; height: number; col: number; cols: number };

/**
 * Where each timed event sits in one day column: `top`/`height` in minutes from midnight (clipped to the day,
 * at least MIN_BLOCK_MIN tall), and overlapping events side by side (`col` of `cols`), like Google Calendar.
 */
export function layoutDay(events: Span[], day: Date): Placed[] {
  const d0 = startOfDay(day).getTime();
  const d1 = addDays(startOfDay(day), 1).getTime();
  const items = events
    .filter((e) => overlapsDay(e, day))
    .map((e) => {
      const top = e.start.getTime() <= d0 ? 0 : minuteOfDay(e.start);
      const endMin = e.end.getTime() >= d1 ? DAY_MIN : Math.max(minuteOfDay(e.end), top);
      const bottom = Math.min(DAY_MIN, Math.max(endMin, top + MIN_BLOCK_MIN));
      return { id: e.id, top: Math.min(top, DAY_MIN - MIN_BLOCK_MIN), bottom };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || (a.id < b.id ? -1 : 1));

  const out: Placed[] = [];
  let cluster: { id: string; top: number; bottom: number; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) out.push({ id: c.id, top: c.top, height: c.bottom - c.top, col: c.col, cols });
    cluster = [];
    colEnds = [];
  };
  for (const it of items) {
    if (cluster.length && it.top >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.bottom);
    } else colEnds[col] = it.bottom;
    cluster.push({ ...it, col });
    clusterEnd = Math.max(cluster.length === 1 ? it.bottom : clusterEnd, it.bottom);
  }
  if (cluster.length) flush();
  return out;
}

/** Position of the red "now" line in minutes, or null when `day` isn't today. */
export function nowOffset(now: Date, day: Date) {
  return isSameDay(now, day) ? minuteOfDay(now) : null;
}

/** The time you clicked in a day column (`y` pixels from the top, `hourPx` per hour), snapped to half hours. */
export function slotAt(day: Date, y: number, hourPx: number, snap = 30) {
  const raw = Math.max(0, Math.min(DAY_MIN - snap, (y / hourPx) * 60));
  const m = Math.floor(raw / snap) * snap;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
}

/** "9 AM", "12 PM" labels for the hour rows. */
export const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

/** Groups events by local day for the Agenda view (only days inside [start, end) that have something). */
export function groupByDay<T extends Span>(events: T[], start: Date, end: Date) {
  const out: { day: Date; items: T[] }[] = [];
  for (let d = startOfDay(start); d < end; d = addDays(d, 1)) {
    const items = events.filter((e) => overlapsDay(e, d)).sort((a, b) => a.start.getTime() - b.start.getTime());
    if (items.length) out.push({ day: d, items });
  }
  return out;
}

export type RoundTone = "blue" | "pink" | "orange" | "violet" | "teal" | "green" | "slate" | "gold" | "gray";

/** Calendar color for an interview round (one hue per type, like Google's event colors). */
export function roundTone(round: string): RoundTone {
  const r = round.toLowerCase();
  if (/offer/.test(r)) return "gold";
  if (/final|onsite/.test(r)) return "green";
  if (/panel/.test(r)) return "teal";
  if (/case|take-home|take home/.test(r)) return "violet";
  if (/assessment|deadline|test/.test(r)) return "slate";
  if (/technical|coding|system/.test(r)) return "orange";
  if (/hiring manager|manager/.test(r)) return "pink";
  if (/recruiter|screen|phone/.test(r)) return "blue";
  return "gray";
}
