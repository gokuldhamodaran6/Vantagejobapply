"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Info, RefreshCw, SlidersHorizontal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ACTIVE, NEEDS_YOU } from "@/lib/agent/status";
import { PRIORITIES, priorityMeta } from "@/lib/agent/plan";
import type { Pipeline } from "@/lib/jobs/engine";
import type { TargetRole } from "@/lib/types";
import { agoShort, useTicker, type LightTask } from "./shared";

type Resp = Pipeline & { limit: number; usedToday: number; resetsAt: string; error?: string };

const PRIORITY_TONE: Record<number, string> = { 1: "bg-pink-tint text-pink-ink", 2: "bg-brand-tint text-brand-ink", 3: "bg-line-2 text-ink-2" };

/**
 * "Matched & waiting": the honest funnel between Live jobs and what the agent applies to today,
 * per target, with the reasons the rest wait — and each target's priority editable in place.
 */
export function MatchedWaiting({
  roles, index, enabled, autonomy, limit, usedToday, refreshKey = 0, onRolesChanged, onToast,
}: {
  roles: TargetRole[];
  index: LightTask[] | null;
  enabled: boolean;
  autonomy: string | null | undefined;
  limit: number;
  usedToday: number;
  /** Bumped by the page's Refresh button. */
  refreshKey?: number;
  onRolesChanged: () => Promise<void>;
  onToast: (m: string) => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const now = useTicker(15_000);
  const rolesKey = roles.map((r) => `${r.id}:${r.priority}:${r.active}:${r.title}:${r.levels.join(",")}`).join("|");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/agent/pipeline").catch(() => null);
    const d = r ? ((await r.json().catch(() => null)) as Resp | null) : null;
    setLoading(false);
    if (!r?.ok || !d || d.error) return setFailed(true);
    setFailed(false);
    setData(d);
  }, []);

  // Recount when targets change, and every few minutes while the page is open.
  useEffect(() => {
    void load();
  }, [load, rolesKey, refreshKey]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 180_000);
    return () => clearInterval(i);
  }, [load]);

  const perRole = useMemo(() => {
    const m = new Map<string, { applied: number; inLine: number; needs: number }>();
    for (const t of index || []) {
      const id = t.job?.role_id;
      if (!id) continue;
      const x = m.get(id) || { applied: 0, inLine: 0, needs: 0 };
      if (t.status === "submitted") x.applied += 1;
      else if (ACTIVE.includes(t.status)) x.inLine += 1;
      else if (NEEDS_YOU.includes(t.status)) x.needs += 1;
      m.set(id, x);
    }
    return m;
  }, [index]);

  async function setPriority(r: TargetRole, p: number) {
    if (p === r.priority) return;
    setSaving(r.id);
    const { error } = await supabaseBrowser().from("target_roles").update({ priority: p }).eq("id", r.id);
    await onRolesChanged();
    setSaving(null);
    onToast(error ? error.message : `${r.title}: ${priorityMeta(p).label.toLowerCase()}. Your agent re-balances today's applications.`);
  }

  const active = roles.filter((r) => r.active);
  const paused = roles.filter((r) => !r.active);
  const left = Math.max(0, limit - usedToday);
  const inLine = (index || []).filter((t) => ACTIVE.includes(t.status)).length;
  const reset = data ? new Date(data.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const skipped = Object.entries(data?.skipped || {}).filter(([, n]) => (n || 0) > 0).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const roleData = new Map((data?.roles || []).map((r) => [r.id, r]));

  if (!roles.length) {
    return (
      <section className="mt-5 card p-5" aria-labelledby="pipeline-h">
        <h2 id="pipeline-h" className="font-bold">Matched &amp; waiting</h2>
        <p className="mt-1 text-sm text-muted">Add a target role and your agent shows how many live jobs fit it, and which ones it will apply to.</p>
        <Link href="/app/targets" className="btn-primary mt-3 min-h-9 text-[13px]">Add a target role</Link>
      </section>
    );
  }

  return (
    <section className="mt-5 card overflow-hidden" aria-labelledby="pipeline-h" aria-busy={loading}>
      <div className="flex flex-wrap items-start gap-3 p-5 pb-4">
        <div className="min-w-0 flex-1">
          <h2 id="pipeline-h" className="font-bold">Matched &amp; waiting</h2>
          <p className="text-sm text-muted">Live jobs that fit your targets right now, and what your agent does with them.</p>
        </div>
        <div className="flex items-center gap-1">
          {data && <span className="hidden text-xs text-muted sm:inline">Counted {agoShort(Date.parse(data.computedAt), now)}</span>}
          <button className="rounded-lg p-2 text-subtle hover:bg-canvas hover:text-ink" onClick={() => void load()} disabled={loading} aria-label="Recount matches">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <Link href="/app/targets" className="btn-ghost min-h-9 text-[13px]"><SlidersHorizontal size={14} /> Edit targets</Link>
        </div>
      </div>

      {/* The funnel */}
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-4">
        {[
          { k: "Live matches", v: data?.live, sub: "open jobs fit your targets", href: "/app/jobs" },
          { k: "Already handled", v: data?.handled, sub: "applied, in line or skipped" },
          { k: "Ready for your agent", v: data?.ready, sub: "pass every auto-apply check", tone: "text-brand-ink" },
          { k: "Left today", v: `${left} of ${limit}`, sub: reset ? `daily limit · resets ${reset}` : "daily limit", tone: left ? "text-green-ink" : "text-orange-ink" },
        ].map((s) => (
          <div key={s.k} className="bg-white p-4">
            <p className="text-xs font-medium text-muted">{s.k}</p>
            {s.v === undefined ? <div className="skeleton mt-1.5 h-7 w-16" /> : <p className={`mt-0.5 text-2xl font-bold tracking-tight tabular-nums ${s.tone || "text-ink"}`}>{typeof s.v === "number" ? s.v.toLocaleString() : s.v}</p>}
            <p className="mt-0.5 text-[11px] leading-snug text-subtle">{s.href ? <Link href={s.href} className="hover:text-brand-ink">{s.sub} →</Link> : s.sub}</p>
          </div>
        ))}
      </div>

      {failed && !data && <p className="px-5 py-3 text-sm text-muted">Couldn&apos;t count your matches right now. <button className="font-semibold text-brand-ink" onClick={() => void load()}>Try again</button></p>}

      {/* Per target */}
      <div className="px-5 py-4">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_140px_repeat(4,minmax(0,0.6fr))_24px] gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-subtle md:grid">
          <span>Target</span><span>Priority</span><span className="text-right">Live</span><span className="text-right">Ready</span><span className="text-right">Today</span><span className="text-right">Applied</span><span />
        </div>
        <ul className="space-y-2">
          {active.map((r) => {
            const d = roleData.get(r.id);
            const mine = perRole.get(r.id);
            const stat = (label: string, v: number | undefined, tone = "") => (
              <span className="flex items-baseline justify-between gap-2 md:block md:text-right">
                <span className="text-xs text-muted md:hidden">{label}</span>
                {v === undefined ? <span className="skeleton inline-block h-4 w-8" /> : <span className={`text-sm font-semibold tabular-nums ${tone}`}>{v}</span>}
              </span>
            );
            return (
              <li key={r.id} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-[minmax(0,1.6fr)_140px_repeat(4,minmax(0,0.6fr))_24px] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold capitalize">{r.title}</p>
                  <p className="truncate text-xs text-muted">
                    {mine?.inLine ? `${mine.inLine} in the queue now` : d ? `${d.planned} planned today` : "Counting…"}
                    {mine?.needs ? ` · ${mine.needs} need you` : ""}
                    {r.levels.length ? ` · ${r.levels.map((l) => (l === "entry" ? "entry" : l)).join(", ")}` : ""}
                  </p>
                </div>
                <label className="block">
                  <span className="sr-only">Priority for {r.title}</span>
                  <select
                    className={`input min-h-9 rounded-full border-0 py-0 text-[13px] font-semibold ${PRIORITY_TONE[priorityMeta(r.priority).value]}`}
                    value={priorityMeta(r.priority).value}
                    disabled={saving === r.id}
                    onChange={(e) => void setPriority(r, Number(e.target.value))}
                  >
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:contents">
                  {stat("Live matches", d?.live)}
                  {stat("Ready for agent", d?.ready, "text-brand-ink")}
                  {stat("Planned today", d?.planned, "text-green-ink")}
                  {stat("Applied", mine?.applied ?? (index ? 0 : undefined))}
                </div>
                <Link href={`/app/jobs?role=${r.id}`} className="hidden justify-self-end rounded-md p-1 text-subtle hover:bg-canvas hover:text-brand-ink md:block" aria-label={`See ${r.title} jobs in Live jobs`}><ArrowRight size={15} /></Link>
                <Link href={`/app/jobs?role=${r.id}`} className="text-xs font-semibold text-brand-ink md:hidden">See {d?.live ?? ""} live jobs →</Link>
              </li>
            );
          })}
        </ul>
        {paused.length > 0 && (
          <p className="mt-2 text-xs text-muted">Paused: {paused.map((r) => r.title).join(", ")} · <Link href="/app/targets" className="font-semibold text-brand-ink">Turn back on</Link></p>
        )}
      </div>

      {/* The actual jobs, in the agent's order */}
      <div className="border-t border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold">
            Up next for auto-apply
            {data && <span className="ml-1.5 font-medium text-muted">· {data.upNext.filter((j) => j.today).length} today{data.ready > data.upNext.filter((j) => j.today).length ? ` · ${data.ready - data.upNext.filter((j) => j.today).length} after that` : ""}</span>}
          </h3>
          {!enabled && <span className="text-xs font-semibold text-orange-ink">Auto-apply is off — nothing here is sent until you turn it on</span>}
        </div>
        {!data ? (
          <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
        ) : data.upNext.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No new jobs pass every check right now. Your agent looks again every 10 minutes — widen levels, locations or freshness in <Link href="/app/targets" className="font-semibold text-brand-ink">My targets</Link> to give it more to work with.</p>
        ) : (
          <>
            <ol className="mt-3 divide-y divide-line rounded-xl border border-line">
              {(showAll ? data.upNext : data.upNext.slice(0, 8)).map((j, i) => {
                const role = roles.find((r) => r.id === j.roleId);
                return (
                  <li key={j.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <a href={j.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold hover:text-brand-ink">{j.title}</a>
                      <span className="block truncate text-xs text-muted">{j.company}{j.location ? ` · ${j.location}` : ""}{role ? ` · ${role.title}` : ""}{j.posted ? ` · posted ${agoShort(Date.parse(j.posted), now)}` : ""}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs font-semibold tabular-nums text-green-ink sm:block">{j.score}% match</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${j.today ? "bg-green-tint text-green-ink" : "bg-line-2 text-ink-2"}`}>{j.today ? "Today" : "Later"}</span>
                  </li>
                );
              })}
            </ol>
            {data.upNext.length > 8 && (
              <button className="mt-2 text-xs font-semibold text-brand-ink" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${data.upNext.length}${data.ready > data.upNext.length ? ` (of ${data.ready})` : ""}`}</button>
            )}
            <p className="mt-2 text-[11px] text-subtle">Your agent applies one job at a time, a few per run, at most one per company per run. A job already applied to — or a repost of one — is never sent again.</p>
          </>
        )}
      </div>

      {/* Why not everything today */}
      <details className="group border-t border-line bg-canvas/50 px-5 py-4" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <Info size={15} className="text-brand" aria-hidden /> Why isn&apos;t every match applied today?
          <span className="ml-auto text-xs font-medium text-muted group-open:hidden">Show</span>
        </summary>
        <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-ink-2">
          {!enabled ? (
            <li><b>Auto-apply is off.</b> Your agent only applies when you press “Apply with agent” or paste a link — turn it on above to have it work through these matches by itself.</li>
          ) : autonomy === "approve_all" ? (
            <li><b>You approve every application.</b> Your agent lines up its best matches with a tailored resume, and each waits under “Needs you” until you approve it — nothing is sent before that.</li>
          ) : null}
          <li>
            <b>A daily limit of {limit}.</b> Fewer, tailored applications get more interviews and keep careers sites from flagging you, so your agent sends up to {limit} a day{usedToday ? ` (${usedToday} used today${inLine ? `, ${inLine} in line` : ""})` : ""} and carries the rest over.{" "}
            <Link href="/app/settings#agent-mode" className="font-semibold text-brand-ink">Raise your limit in Settings</Link>.
          </li>
          <li>
            <b>Top-priority targets go first.</b> Each round your agent takes 3 jobs from a Top-priority target, 2 from High and 1 from Normal — best matches first — so every target gets its turn.
          </li>
          <li>
            <b>Only strong, safe matches.</b> Live jobs shows anything that fits; your agent only spends an application on close matches posted in the last {data?.freshDays ?? 14} days, in your locations, on careers sites Vantage has verified, and never on likely ghost jobs — at most 3 per employer a month.
            {skipped.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {skipped.map(([k, n]) => <span key={k} className="chip bg-white text-ink-2 ring-1 ring-line">{n} · {k.toLowerCase()}</span>)}
              </span>
            )}
          </li>
          <li className="text-muted">The rest stay in <Link href="/app/jobs" className="font-semibold text-brand-ink">Live jobs</Link> for you — press “Apply with agent” on any of them and it goes straight into line. To widen what the agent takes, adjust levels, locations or freshness in <Link href="/app/targets" className="font-semibold text-brand-ink">My targets</Link>.</li>
        </ul>
      </details>
    </section>
  );
}
