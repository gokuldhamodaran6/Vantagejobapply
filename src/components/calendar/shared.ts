import { isAllDay, roundTone, type RoundTone } from "@/lib/calendar-grid";

/** A row of the `interviews` table. */
export type Interview = {
  id: string;
  application_id: string | null;
  company: string;
  title: string | null;
  round: string;
  starts_at: string;
  minutes: number;
  timezone?: string | null;
  location: string | null;
  link: string | null;
  notes: string | null;
  source: "manual" | "email";
  inbox_message_id: string | null;
  status: "scheduled" | "done" | "cancelled";
};

/** An interview placed on the calendar. */
export type CalEvent = { id: string; start: Date; end: Date; allDay: boolean; iv: Interview };

export function toEvents(list: Interview[]): CalEvent[] {
  return list.map((iv) => {
    const start = new Date(iv.starts_at);
    return { id: iv.id, start, end: new Date(start.getTime() + Math.max(1, iv.minutes) * 60000), allDay: isAllDay(iv.minutes), iv };
  });
}

/** Event colors per round. Light-theme tokens matching globals.css (the app has no dark theme). */
export const TONES: Record<RoundTone, { bg: string; fg: string; bar: string }> = {
  blue: { bg: "#e4ebfd", fg: "#1f3fae", bar: "#2f5beb" },
  pink: { bg: "#fbe3ec", fg: "#a01f50", bar: "#e0457b" },
  orange: { bg: "#ffead7", fg: "#9a4508", bar: "#f7862b" },
  violet: { bg: "#efe8fd", fg: "#5b33b0", bar: "#8b5cf6" },
  teal: { bg: "#dff3f4", fg: "#0c5f67", bar: "#14a3ad" },
  green: { bg: "#ddf3e6", fg: "#146b3e", bar: "#22a05b" },
  slate: { bg: "#e8ebf1", fg: "#343b4b", bar: "#6b7385" },
  gold: { bg: "#fdf3cf", fg: "#6e5300", bar: "#e0b000" },
  gray: { bg: "#eef0f4", fg: "#3a4254", bar: "#9aa1b0" },
};
export const toneOf = (round: string) => TONES[roundTone(round)];

/** The legend: what each color means. */
export const LEGEND: { label: string; tone: RoundTone }[] = [
  { label: "Recruiter screen", tone: "blue" },
  { label: "Hiring manager", tone: "pink" },
  { label: "Technical", tone: "orange" },
  { label: "Case / take-home", tone: "violet" },
  { label: "Panel", tone: "teal" },
  { label: "Final round", tone: "green" },
  { label: "Assessment / deadline", tone: "slate" },
  { label: "Offer call", tone: "gold" },
];

export const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** Google-style compact time: "10am", "2:30pm". */
export function shortTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
export const timeRange = (e: CalEvent) => (e.allDay ? "All day" : `${fmtTime(e.start)} – ${fmtTime(e.end)}`);

/** The text that goes into Google Calendar / .ics for an interview. */
export const calDetails = (i: Interview) => `${i.round}${i.title ? ` · ${i.title}` : ""} at ${i.company}${i.link ? `\nJoin: ${i.link}` : ""}${i.notes ? `\n\n${i.notes}` : ""}\n\nPrepared with Vantage`;
export const calTitle = (i: Interview) => `${i.round}: ${i.company}`;
