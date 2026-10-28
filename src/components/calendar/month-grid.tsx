"use client";
import { isSameDay, monthGrid, overlapsDay } from "@/lib/calendar-grid";
import { shortTime, toneOf, type CalEvent, type Interview } from "./shared";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;
const longDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** Month view: six weeks, up to three event chips a day and "+N more" (which opens that day). */
export function MonthGrid({ anchor, events, now, onOpen, onCreate, onPickDay }: {
  anchor: Date;
  events: CalEvent[];
  now: Date;
  onOpen: (iv: Interview) => void;
  onCreate: (at: Date, allDay?: boolean) => void;
  onPickDay: (d: Date) => void;
}) {
  const days = monthGrid(anchor);
  return (
    <div className="text-sm">
      <div className="grid grid-cols-7 border-b border-line">
        {DOW.map((w) => (
          <div key={w} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span className="sm:hidden" aria-hidden>{w[0]}</span><span className="hidden sm:inline">{w}</span><span className="sr-only sm:hidden">{w}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, idx) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = isSameDay(d, now);
          const evs = events.filter((e) => overlapsDay(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
          return (
            <div
              key={d.toISOString()}
              onClick={(e) => { if (e.target === e.currentTarget) onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10)); }}
              className={`min-h-[84px] cursor-pointer border-b border-r border-line p-1 transition hover:bg-brand-soft/60 sm:min-h-[112px] ${idx % 7 === 6 ? "border-r-0" : ""} ${idx >= 35 ? "border-b-0" : ""} ${inMonth ? "bg-white" : "bg-canvas/60"}`}
            >
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => onPickDay(d)}
                  aria-label={`Show ${longDay(d)}${evs.length ? `, ${evs.length} interview${evs.length > 1 ? "s" : ""}` : ""}`}
                  aria-current={today ? "date" : undefined}
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold ${today ? "bg-brand text-white" : inMonth ? "text-ink hover:bg-line-2" : "text-subtle hover:bg-line-2"}`}
                >
                  {d.getDate() === 1 && !today ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.getDate()}
                </button>
              </div>
              <div className="mt-0.5 space-y-px">
                {evs.slice(0, MAX_CHIPS).map((e) => {
                  const t = toneOf(e.iv.round);
                  const past = e.end.getTime() < now.getTime();
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpen(e.iv)}
                      aria-label={`${e.iv.company}, ${e.iv.round}, ${e.allDay ? "all day" : shortTime(e.start)}`}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-px text-left text-[11.5px] ${e.allDay ? "font-semibold" : "hover:bg-line-2"} ${past ? "opacity-60" : ""} ${e.iv.status === "done" ? "line-through" : ""}`}
                      style={e.allDay ? { background: t.bg, color: t.fg, boxShadow: `inset 3px 0 0 ${t.bar}` } : undefined}
                    >
                      {!e.allDay && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.bar }} />}
                      {!e.allDay && <span className="hidden shrink-0 text-muted sm:inline">{shortTime(e.start)}</span>}
                      <span className="truncate font-semibold">{e.iv.company}</span>
                    </button>
                  );
                })}
                {evs.length > MAX_CHIPS && (
                  <button type="button" onClick={() => onPickDay(d)} className="w-full rounded px-1 py-px text-left text-[11px] font-semibold text-muted hover:bg-line-2">
                    +{evs.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
