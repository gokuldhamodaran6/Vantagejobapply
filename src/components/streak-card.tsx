"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { computeStreak, streakNudge, weekdayLetter } from "@/lib/streak";

const LOOKBACK_DAYS = 120;
const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/**
 * Daily application streak: a day counts when you applied to at least one job (extension, manual, or found in
 * your job email). Today not done yet keeps the streak alive until midnight — the nudge asks you to apply today.
 */
export function StreakCard({ className = "" }: { className?: string }) {
  const { userId } = useMe();
  const [days, setDays] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!userId) return;
    const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
    supabaseBrowser()
      .from("applications")
      .select("applied_at")
      .eq("user_id", userId) // admins can read everyone's rows; the streak is only yours
      .not("applied_at", "is", null)
      .gte("applied_at", since)
      .order("applied_at", { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        setDays(((data as { applied_at: string }[]) || []).map((r) => r.applied_at));
        setNow(Date.now());
      });
  }, [userId]);

  const s = useMemo(() => (days ? computeStreak(days, new Date(now), zone()) : null), [days, now]);

  if (!s) return <div className={`skeleton h-[168px] rounded-xl ${className}`} />;

  const lit = s.current > 0;
  return (
    <section className={`card p-5 ${className}`} aria-labelledby="streak-h">
      <div className="flex items-start gap-4">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${lit ? (s.todayDone ? "bg-gradient-to-br from-orange to-pink text-white shadow-lg shadow-orange/25" : "bg-orange-tint text-orange") : "bg-line-2 text-subtle"}`}>
          <Flame size={28} fill={lit && s.todayDone ? "currentColor" : "none"} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="streak-h" className="text-sm font-semibold text-muted">Daily streak</h2>
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {s.current} <span className="text-base font-semibold text-ink-2">day{s.current === 1 ? "" : "s"}</span>
          </p>
          <p className="text-xs text-muted">Best: {s.best} day{s.best === 1 ? "" : "s"}</p>
        </div>
      </div>
      <ol className="mt-4 flex justify-between gap-1" aria-label="Last 7 days">
        {s.last7Days.map((k, i) => {
          const done = s.last7[i];
          const today = i === 6;
          const label = new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
          return (
            <li key={k} className="flex flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-orange text-white" : today ? "border-2 border-dashed border-orange/60 text-orange-ink" : "bg-line-2 text-subtle"}`}
                aria-label={`${label}${today ? " (today)" : ""}: ${done ? "applied" : "no applications"}`}
                role="img"
              >
                {done ? "✓" : ""}
              </span>
              <span className={`text-[11px] font-semibold ${today ? "text-ink" : "text-subtle"}`} aria-hidden>{weekdayLetter(k)}</span>
            </li>
          );
        })}
      </ol>
      <p className={`mt-3 text-sm ${s.atRisk ? "font-semibold text-orange-ink" : "text-ink-2"}`}>
        {streakNudge(s)}{" "}
        {!s.todayDone && <Link href="/app/jobs" className="font-semibold text-brand-ink underline-offset-2 hover:underline">Find a job</Link>}
      </p>
    </section>
  );
}
