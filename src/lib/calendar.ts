/** Calendar helpers shared by the interviews page and the application drawer. */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Local calendar date "YYYYMMDD" (for all-day events). */
const dateStamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
/** Whole local days an all-day event covers (at least one). */
const allDayEnd = (start: Date, minutes: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.max(1, Math.round(minutes / 1440)));

export function googleCalendarUrl(title: string, start: Date, minutes: number, details: string, location = "", allDay = false) {
  const end = new Date(start.getTime() + minutes * 60000);
  const dates = allDay ? `${dateStamp(start)}/${dateStamp(allDayEnd(start, minutes))}` : `${stamp(start)}/${stamp(end)}`;
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates, details, location });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function downloadIcs(events: { id: string; title: string; start: Date; minutes: number; details: string; location?: string; allDay?: boolean }[], filename = "interviews.ics") {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vantage//Interviews//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    const end = new Date(e.start.getTime() + e.minutes * 60000);
    const when = e.allDay
      ? [`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(allDayEnd(e.start, e.minutes))}`]
      : [`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(end)}`];
    lines.push("BEGIN:VEVENT", `UID:${e.id}@vantage`, `DTSTAMP:${stamp(new Date())}`, ...when, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.details)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push("BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Interview in 30 minutes", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const ROUNDS = ["Recruiter screen", "Hiring manager", "Technical interview", "Case / take-home", "Panel", "Final round", "Assessment", "Offer call"];

/** A round name from an email subject ("Phone screen with Acme" → "Recruiter screen"). */
export function guessRound(text: string) {
  const t = text.toLowerCase();
  if (/final|onsite|on-site|super ?day/.test(t)) return "Final round";
  if (/panel|loop/.test(t)) return "Panel";
  if (/technical|coding|system design|case/.test(t)) return "Technical interview";
  if (/hiring manager|manager/.test(t)) return "Hiring manager";
  if (/assessment|test|hackerrank|codility/.test(t)) return "Assessment";
  if (/offer/.test(t)) return "Offer call";
  return "Recruiter screen";
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "datetime-local" input value for a Date in the viewer's zone. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
