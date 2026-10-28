"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented } from "@/components/ui";
import { gridDays, rangeFor, rangeTitle, shiftAnchor, startOfDay, type CalView } from "@/lib/calendar-grid";
import { Agenda } from "./agenda";
import { MonthGrid } from "./month-grid";
import { WeekGrid } from "./week-grid";
import { LEGEND, TONES, type CalEvent, type Interview } from "./shared";

const PHONE = "(max-width: 639px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** True on phones (< 640px). False while rendering on the server, then corrected on the client. */
const usePhone = () => useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);

const VIEWS: { value: CalView; label: string; key: string }[] = [
  { value: "day", label: "Day", key: "d" },
  { value: "week", label: "Week", key: "w" },
  { value: "month", label: "Month", key: "m" },
  { value: "agenda", label: "Agenda", key: "a" },
];

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * The Interviews calendar, laid out like Google Calendar: Today, ‹ ›, the range title and a view switcher;
 * Day / Week time grids, a Month grid and an Agenda list. Keys: t today, d/w/m/a views, ← → previous/next, c add.
 */
export function CalendarView({ events, loading, paused, onOpen, onCreate }: {
  events: CalEvent[];
  loading: boolean;
  /** A sheet is open: keyboard shortcuts pause. */
  paused: boolean;
  onOpen: (iv: Interview) => void;
  onCreate: (at?: Date, allDay?: boolean) => void;
}) {
  const phone = usePhone();
  const [picked, setPicked] = useState<CalView | null>(null);
  const view: CalView = picked ?? (phone ? "agenda" : "week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  // Keyboard shortcuts (ignored while typing or when a sheet is open).
  const state = useRef({ view, paused, onCreate });
  useEffect(() => {
    state.current = { view, paused, onCreate };
  }, [view, paused, onCreate]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if (s.paused || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      const v = VIEWS.find((x) => x.key === k);
      if (v) setPicked(v.value);
      else if (k === "t") setAnchor(startOfDay(new Date()));
      else if (e.key === "ArrowLeft" || k === "k" || k === "p") setAnchor((a) => shiftAnchor(s.view, a, -1));
      else if (e.key === "ArrowRight" || k === "j" || k === "n") setAnchor((a) => shiftAnchor(s.view, a, 1));
      else if (k === "c") s.onCreate();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const range = rangeFor(view, anchor);
  const title = rangeTitle(view, anchor);
  const unit = view === "agenda" ? "30 days" : view;
  const pickDay = (d: Date) => {
    setAnchor(startOfDay(d));
    setPicked("day");
  };

  return (
    <section className="card overflow-hidden" aria-label="Interview calendar">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-4">
        <button type="button" className="btn-secondary min-h-9 px-3.5 text-[13px]" onClick={() => setAnchor(startOfDay(new Date()))} aria-keyshortcuts="t" title="Today (T)">Today</button>
        <div className="flex items-center">
          <button type="button" className="rounded-full p-2 text-ink-2 hover:bg-canvas" aria-label={`Previous ${unit}`} aria-keyshortcuts="ArrowLeft" title={`Previous ${unit} (←)`} onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}><ChevronLeft size={20} /></button>
          <button type="button" className="rounded-full p-2 text-ink-2 hover:bg-canvas" aria-label={`Next ${unit}`} aria-keyshortcuts="ArrowRight" title={`Next ${unit} (→)`} onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}><ChevronRight size={20} /></button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold sm:text-lg" aria-live="polite" suppressHydrationWarning>{title}</h2>
        <Segmented label="Calendar view" value={view} onChange={setPicked} options={VIEWS.map(({ value, label }) => ({ value, label }))} />
      </div>

      {loading ? (
        <div className="skeleton m-4 h-[520px]" />
      ) : view === "month" ? (
        <MonthGrid anchor={anchor} events={events} now={now} onOpen={onOpen} onCreate={onCreate} onPickDay={pickDay} />
      ) : view === "agenda" ? (
        <Agenda start={range.start} end={range.end} events={events} now={now} onOpen={onOpen} onJump={(d) => setAnchor(startOfDay(d))} />
      ) : (
        <WeekGrid key={view} days={gridDays(view, anchor)} events={events} now={now} onOpen={onOpen} onCreate={onCreate} onPickDay={pickDay} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TONES[l.tone].bar }} aria-hidden />{l.label}</span>
        ))}
        <span className="ml-auto hidden lg:inline">Keys: <kbd className="font-semibold">T</kbd> today · <kbd className="font-semibold">D W M A</kbd> views · <kbd className="font-semibold">← →</kbd> move · <kbd className="font-semibold">C</kbd> add</span>
      </div>
    </section>
  );
}
