"use client";
import { useEffect, useMemo, useRef } from "react";
import { DAY_MIN, hourLabel, isSameDay, layoutDay, nowOffset, overlapsDay, slotAt } from "@/lib/calendar-grid";
import { shortTime, toneOf, type CalEvent, type Interview } from "./shared";

/** Pixels per hour in the time grid. 7am–9pm (14 hours) fit in the default height. */
export const HOUR_PX = 44;
const FIRST_VISIBLE_HOUR = 7;
const VISIBLE_HOURS = 14;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GUTTER = "56px";

const longDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** Day and Week views: hour rows, an all-day row on top, events as blocks, a red line at the current time. */
export function WeekGrid({ days, events, now, onOpen, onCreate, onPickDay }: {
  days: Date[];
  events: CalEvent[];
  now: Date;
  onOpen: (iv: Interview) => void;
  onCreate: (at: Date, allDay?: boolean) => void;
  onPickDay: (d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Open at 7 AM, like Google (the full day stays scrollable).
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX;
  }, []);

  const timed = useMemo(() => events.filter((e) => !e.allDay), [events]);
  const allDay = useMemo(() => events.filter((e) => e.allDay), [events]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const cols = `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`;
  const single = days.length === 1;

  return (
    <div className="text-sm">
      {/* Day headers */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols, scrollbarGutter: "stable", overflowY: "hidden" }}>
        <div className="flex items-end justify-end px-2 pb-1 text-[10px] font-medium text-subtle" aria-hidden>
          {Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value}
        </div>
        {days.map((d) => {
          const today = isSameDay(d, now);
          return (
            <div key={d.toISOString()} className={`flex flex-col py-2 ${single ? "items-start pl-3" : "items-center"}`}>
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${today ? "text-brand-ink" : "text-muted"}`}>{DOW[d.getDay()]}</span>
              <button
                type="button"
                onClick={() => onPickDay(d)}
                aria-label={`Show ${longDay(d)}`}
                aria-current={today ? "date" : undefined}
                className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold transition sm:h-10 sm:w-10 sm:text-xl ${today ? "bg-brand text-white" : "text-ink hover:bg-canvas"}`}
              >
                {d.getDate()}
              </button>
              <button type="button" className="sr-only focus:not-sr-only focus:mt-1 focus:rounded focus:px-1 focus:text-xs focus:font-semibold" onClick={() => onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10))}>
                Add interview on {longDay(d)}
              </button>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols, scrollbarGutter: "stable", overflowY: "hidden" }}>
        <div className="flex items-center justify-end px-2 text-[10px] font-medium uppercase text-subtle">All day</div>
        {days.map((d) => {
          const items = allDay.filter((e) => overlapsDay(e, d));
          return (
            <div key={d.toISOString()} className="min-h-7 space-y-0.5 border-l border-line p-0.5" onClick={(e) => { if (e.target === e.currentTarget) onCreate(d, true); }}>
              {items.map((e) => {
                const t = toneOf(e.iv.round);
                return (
                  <button key={e.id} type="button" onClick={() => onOpen(e.iv)} aria-label={`${e.iv.company}, ${e.iv.round}, all day ${longDay(d)}`}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-semibold ${e.iv.status === "done" ? "line-through opacity-60" : ""}`}
                    style={{ background: t.bg, color: t.fg, boxShadow: `inset 3px 0 0 ${t.bar}` }}>
                    {e.iv.company} · {e.iv.round}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div ref={scroller} className="relative overflow-y-auto" style={{ height: `min(${VISIBLE_HOURS * HOUR_PX}px, max(360px, calc(100dvh - 300px)))`, scrollbarGutter: "stable" }}>
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] font-medium text-subtle" style={{ top: h * HOUR_PX }}>{hourLabel(h)}</span>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutDay(timed, d);
            const nowMin = nowOffset(now, d);
            return (
              <div
                key={d.toISOString()}
                className="relative cursor-pointer border-l border-line"
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0, var(--color-line) 1px, transparent 1px, transparent ${HOUR_PX}px)` }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onCreate(slotAt(d, e.clientY - r.top, HOUR_PX));
                }}
                title="Click to add an interview"
              >
                {placed.map((p) => {
                  const ev = byId.get(p.id);
                  if (!ev) return null;
                  const t = toneOf(ev.iv.round);
                  const h = (p.height / 60) * HOUR_PX;
                  const past = ev.end.getTime() < now.getTime();
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onOpen(ev.iv)}
                      aria-label={`${ev.iv.company}, ${ev.iv.round}, ${longDay(ev.start)} ${shortTime(ev.start)} to ${shortTime(ev.end)}`}
                      className={`absolute overflow-hidden rounded-md px-1.5 text-left leading-tight shadow-[0_1px_2px_rgba(16,24,40,0.08)] ring-1 ring-white transition hover:z-20 hover:shadow-md focus-visible:z-20 ${past ? "opacity-60" : ""} ${ev.iv.status === "done" ? "line-through" : ""}`}
                      style={{
                        top: (p.top / 60) * HOUR_PX + 1,
                        height: Math.max(h - 2, 16),
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        background: t.bg,
                        color: t.fg,
                        borderLeft: `3px solid ${t.bar}`,
                        zIndex: 10 + p.col,
                      }}
                    >
                      {h < 34 ? (
                        <span className="block truncate pt-px text-[11px] font-semibold">{ev.iv.company}, {shortTime(ev.start)}</span>
                      ) : (
                        <>
                          <span className="block truncate pt-1 text-[12px] font-semibold">{ev.iv.company}</span>
                          <span className="block truncate text-[11px]">{shortTime(ev.start)} – {shortTime(ev.end)}</span>
                          {h >= 56 && <span className="block truncate text-[11px] opacity-80">{ev.iv.round}</span>}
                        </>
                      )}
                    </button>
                  );
                })}
                {nowMin !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (Math.min(nowMin, DAY_MIN) / 60) * HOUR_PX }} aria-hidden>
                    <span className="absolute -left-[5px] -top-[5px] h-3 w-3 rounded-full bg-[#ea4335]" />
                    <span className="block h-0.5 bg-[#ea4335]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
