"use client";
import Link from "next/link";
import { Briefcase, CalendarPlus, CheckCircle2, Clock, Download, Mail, MapPin, Pencil, Sparkles, Trash2, Video } from "lucide-react";
import { downloadIcs, googleCalendarUrl } from "@/lib/calendar";
import { isAllDay } from "@/lib/calendar-grid";
import { Sheet } from "./sheet";
import { calDetails, calTitle, fmtTime, toneOf, type Interview } from "./shared";

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** The viewer's zone, e.g. "America/Chicago". */
const myZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
};

/** "11:00 AM EDT" in another zone, or null if the zone isn't valid. */
function inZone(d: Date, tz: string) {
  try {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
  } catch {
    return null;
  }
}

/** Details of one interview: when, where, how to join, the application it belongs to, and actions. */
export function EventSheet({ iv, app, now, onClose, onEdit, onDone, onCancel }: {
  iv: Interview;
  app?: { id: string; job: { title: string; company: string } } | null;
  now: number;
  onClose: () => void;
  onEdit: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = toneOf(iv.round);
  const start = new Date(iv.starts_at);
  const end = new Date(start.getTime() + iv.minutes * 60000);
  const allDay = isAllDay(iv.minutes);
  const zone = myZone();
  const theirs = iv.timezone && iv.timezone !== zone ? inZone(start, iv.timezone) : null;
  const soon = !allDay && start.getTime() - now < 30 * 60000 && end.getTime() > now;
  const prep = `/app/assistant?q=${encodeURIComponent(`Prepare me for my ${iv.round} with ${iv.company}${iv.title ? ` for the ${iv.title} role` : ""}`)}`;
  const where = iv.link || iv.location || "";

  return (
    <Sheet title={iv.company} onClose={onClose} accent={t.bar}>
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: t.bg, color: t.fg }}>{iv.round}</span>
        {iv.title && <span className="text-sm text-muted">{iv.title}</span>}
        {iv.status === "done" && <span className="chip bg-green-tint text-green-ink"><CheckCircle2 size={13} /> Done</span>}
      </div>

      <div className="mt-4 space-y-3 rounded-xl bg-canvas p-4 text-sm">
        <p className="flex items-start gap-2.5">
          <Clock size={16} className="mt-0.5 shrink-0 text-brand" />
          <span>
            <span className="block font-semibold">{start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
            <span className="block text-ink-2">
              {allDay ? "All day" : `${fmtTime(start)} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })} · ${iv.minutes} min`}
            </span>
            {zone && <span className="block text-xs text-muted">Your time zone: {zone.replace(/_/g, " ")}</span>}
            {theirs && <span className="block text-xs text-muted">Their time: {theirs}</span>}
          </span>
        </p>
        {iv.link && (
          <p className="flex items-center gap-2.5">
            <Video size={16} className="shrink-0 text-brand" />
            <a className="min-w-0 truncate font-semibold text-brand-ink underline-offset-2 hover:underline" href={iv.link} target="_blank" rel="noopener noreferrer">{iv.link}</a>
          </p>
        )}
        {iv.location && (
          <p className="flex items-center gap-2.5">
            <MapPin size={16} className="shrink-0 text-brand" />
            <a className="min-w-0 truncate font-semibold text-brand-ink underline-offset-2 hover:underline" href={isUrl(iv.location) ? iv.location : mapsUrl(iv.location)} target="_blank" rel="noopener noreferrer">{iv.location}</a>
          </p>
        )}
        {app && (
          <p className="flex items-center gap-2.5">
            <Briefcase size={16} className="shrink-0 text-brand" />
            <Link className="min-w-0 truncate font-semibold text-brand-ink underline-offset-2 hover:underline" href="/app/applications">Application: {app.job.title} at {app.job.company}</Link>
          </p>
        )}
        {iv.source === "email" && <p className="flex items-center gap-2.5 text-muted"><Mail size={16} className="shrink-0" /> Added from your job email</p>}
      </div>

      {iv.notes && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notes and prep</p>
          <p className="mt-1 whitespace-pre-line text-sm">{iv.notes}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {iv.link && <a className={`${soon ? "btn-primary" : "btn-secondary"} min-h-9 text-[13px]`} href={iv.link} target="_blank" rel="noopener noreferrer"><Video size={15} /> Join</a>}
        <a className="btn-secondary min-h-9 text-[13px]" href={googleCalendarUrl(calTitle(iv), start, iv.minutes, calDetails(iv), where, allDay)} target="_blank" rel="noopener noreferrer"><CalendarPlus size={15} /> Add to Google Calendar</a>
        <button type="button" className="btn-secondary min-h-9 text-[13px]" onClick={() => downloadIcs([{ id: iv.id, title: calTitle(iv), start, minutes: iv.minutes, details: calDetails(iv), location: where, allDay }], "interview.ics")}><Download size={15} /> Download .ics</button>
        <Link className="btn-secondary min-h-9 text-[13px]" href={prep}><Sparkles size={15} /> Prepare me</Link>
      </div>
      <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" className="btn-ghost min-h-9 text-[13px]" onClick={onEdit}><Pencil size={15} /> Edit or reschedule</button>
        {iv.status === "scheduled" && <button type="button" className="btn-ghost min-h-9 text-[13px]" onClick={onDone}><CheckCircle2 size={15} /> Mark as done</button>}
        <button type="button" className="btn-ghost min-h-9 text-[13px] text-red-ink" onClick={onCancel}><Trash2 size={15} /> Cancel interview</button>
      </div>
    </Sheet>
  );
}
