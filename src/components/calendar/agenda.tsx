"use client";
import { ArrowRight, MapPin, Video } from "lucide-react";
import { addDays, groupByDay, isSameDay, spanTitle } from "@/lib/calendar-grid";
import { timeRange, toneOf, type CalEvent, type Interview } from "./shared";

/** Agenda / Schedule view: the days that have something, each with time, company and round. */
export function Agenda({ start, end, events, now, onOpen, onJump }: {
  start: Date;
  end: Date;
  events: CalEvent[];
  now: Date;
  onOpen: (iv: Interview) => void;
  onJump: (d: Date) => void;
}) {
  const groups = groupByDay(events, start, end);
  if (!groups.length) {
    const next = events.filter((e) => e.start >= end).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    const prev = events.filter((e) => e.end <= start).sort((a, b) => b.start.getTime() - a.start.getTime())[0];
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-semibold">Nothing scheduled {spanTitle(start, addDays(end, -1))}</p>
        <p className="mt-1 text-sm text-muted">Invites in your job email show up above to confirm. You can also click Add interview.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {prev && <button type="button" className="btn-secondary min-h-9 text-[13px]" onClick={() => onJump(prev.start)}>Earlier: {prev.iv.company}, {prev.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</button>}
          {next && <button type="button" className="btn-primary min-h-9 text-[13px]" onClick={() => onJump(next.start)}>Next: {next.iv.company}, {next.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} <ArrowRight size={14} /></button>}
        </div>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-line">
      {groups.map(({ day, items }) => {
        const today = isSameDay(day, now);
        return (
          <li key={day.toISOString()} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 px-3 py-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:px-4">
            <div className="flex items-start gap-2 pt-1">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${today ? "bg-brand text-white" : "text-ink"}`}>{day.getDate()}</span>
              <span className={`text-[11px] font-semibold uppercase leading-tight ${today ? "text-brand-ink" : "text-muted"}`}>
                {day.toLocaleDateString(undefined, { month: "short" })}<br />{day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
            </div>
            <ul className="space-y-1">
              {items.map((e) => {
                const t = toneOf(e.iv.round);
                const past = e.end.getTime() < now.getTime();
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => onOpen(e.iv)}
                      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-2 text-left hover:bg-canvas ${past ? "opacity-60" : ""}`}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.bar }} aria-hidden />
                      <span className="w-[150px] shrink-0 text-[13px] text-ink-2 tabular-nums">{timeRange(e)}</span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${e.iv.status === "done" ? "line-through" : ""}`}>
                        <span className="font-semibold">{e.iv.company}</span>
                        <span className="ml-2 rounded px-1.5 py-0.5 text-[11.5px] font-semibold" style={{ background: t.bg, color: t.fg }}>{e.iv.round}</span>
                        {e.iv.title && <span className="ml-2 text-muted">{e.iv.title}</span>}
                      </span>
                      {e.iv.link ? <Video size={16} className="text-brand" aria-label="Video call" /> : e.iv.location ? <MapPin size={16} className="text-muted" aria-label="In person" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
