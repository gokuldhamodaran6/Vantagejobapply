"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ACTIVE, NEEDS_YOU } from "@/lib/agent/status";
import { PRIORITIES, priorityMeta } from "@/lib/agent/plan";
import type { Pipeline } from "@/lib/jobs/engine";
import type { TargetRole } from "@/lib/types";
import { agoShort, useTicker, type LightTask } from "./shared";

type Resp = Pipeline & { limit: number; usedToday: number; resetsAt: string; error?: string };

const PRIORITY_TONE: Record<number, string> = { 1: "bg-pink-tint text-pink-ink", 2: "bg-brand-tint text-brand-ink", 3: "bg-line-2 text-ink-2" };

/** Load the agent's funnel once for the page (the hero and the funnel both read it). */
export function usePipeline(refreshKey: number, rolesKey: string) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const cached = JSON.parse(localStorage.getItem("vantage.pipeline") || "null") as Resp | null;
      if (cached) setData((cur) => cur || cached);
    } catch { /* storage unavailable */ }
    const r = await fetch(`/api/agent/pipeline${fresh ? "?fresh=1" : ""}`).catch(() => null);
    const d = r ? ((await r.json().catch(() => null)) as Resp | null) : null;
    setLoading(false);
    if (!r?.ok || !d || d.error) return setFailed(true);
    setFailed(false);
    setData(d);
    try { localStorage.setItem("vantage.pipeline", JSON.stringify(d)); } catch { /* full or blocked */ }
  }, []);
  useEffect(() => { void load(refreshKey > 0); }, [load, refreshKey, rolesKey]);
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 180_000);
    return () => clearInterval(i);
  }, [load]);
  return { data, loading, failed, load };
}

type Row = { label: string; n: number | undefined; kind: "total" | "minus" | "result"; action?: { label: string; href?: string; run?: () => Promise<void> } };

/**
 * "Why these jobs": the honest path from every open job that matches your targets' titles to the few your agent
 * applies to today — each cut in plain words, with the one change that would widen it.
 */
export function JobFunnel({
  data, loading, failed, onReload, roles, index, enabled, limit, usedToday, onRolesChanged, onToast,
}: {
  data: Resp | null; loading: boolean; failed: boolean; onReload: (fresh?: boolean) => void;
  roles: TargetRole[]; index: LightTask[] | null; enabled: boolean; limit: number; usedToday: number;
  onRolesChanged: () => Promise<void>; onToast: (m: string) => void;
}) {
  const now = useTicker(15_000);
  const [showTargets, setShowTargets] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const active = roles.filter((r) => r.active);
  const left = Math.max(0, limit - usedToday);
  const today = data ? data.upNext.filter((j) => j.today) : [];
  const sk = data?.skipped || {};
  const hid = data?.hidden || {};
  const fresh = data?.freshDays ?? 14;

  async function widenFreshness() {
    const { error } = await supabaseBrowser().from("target_prefs").update({ max_days_old: 30 }).eq("user_id", (await supabaseBrowser().auth.getUser()).data.user?.id || "");
    onToast(error ? error.message : "Your agent now also takes jobs posted in the last 30 days. Recounting…");
    onReload(true);
  }

  const rows = ([
    { label: `Open jobs with your target titles${data?.countries?.length ? ` (${data.countries.join(", ")}, last 60 days)` : ""}`, n: data?.found ?? undefined, kind: "total", action: { label: "See them in Live jobs", href: "/app/jobs" } },
    { label: "Your visa setting rules them out", n: hid["Visa or eligibility"], kind: "minus", action: { label: "Visa setting", href: "/app/targets#visa" } },
    { label: "Above the levels you picked", n: hid["Above your levels"], kind: "minus", action: { label: "Edit levels", href: "/app/targets#roles" } },
    { label: "Not close enough to your targets", n: hid["Not close enough to your targets"], kind: "minus" },
    { label: "Outside your locations or work arrangement", n: (hid["Outside your locations"] || 0) + (hid["Not your work arrangement"] || 0) || undefined, kind: "minus", action: { label: "Edit locations", href: "/app/targets#where" } },
    { label: "Match your targets", n: data?.live, kind: "result" },
    { label: "Already applied, in line, or skipped by you", n: data?.handled, kind: "minus" },
    { label: `Posted more than ${fresh} days ago`, n: sk["Older than your freshness setting"], kind: "minus", action: fresh < 30 ? { label: "Include up to 30 days", run: widenFreshness } : undefined },
    { label: "A level above yours (your agent asks you first)", n: sk["More senior than your levels"], kind: "minus", action: { label: "Edit levels", href: "/app/targets#roles" } },
    { label: "Weaker match (you can still apply from Live jobs)", n: sk["Not a close enough match"], kind: "minus" },
    { label: "Outside your locations or work arrangement", n: (sk["Outside your locations"] || 0) + (sk["Not your work arrangement"] || 0) || undefined, kind: "minus" },
    { label: "Visa rules", n: sk["Visa or eligibility rules"], kind: "minus" },
    { label: "Likely ghost job or site not verified", n: (sk["Likely ghost job"] || 0) + (sk["Careers site not verified yet"] || 0) || undefined, kind: "minus" },
    { label: "Already 3 applications to that company this month", n: sk["Employer limit reached"], kind: "minus" },
    { label: "Ready for your agent", n: data?.ready, kind: "result" },
  ] as Row[]).filter((r) => r.kind !== "minus" || (r.n || 0) > 0);

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
  const roleData = new Map((data?.roles || []).map((r) => [r.id, r]));

  async function setPriority(r: TargetRole, p: number) {
    if (p === r.priority) return;
    setSaving(r.id);
    const { error } = await supabaseBrowser().from("target_roles").update({ priority: p }).eq("id", r.id);
    await onRolesChanged();
    setSaving(null);
    onToast(error ? error.message : `${r.title}: ${priorityMeta(p).label.toLowerCase()}. Your agent re-balances today's applications.`);
  }

  if (!roles.length) {
    return (
      <section className="card p-5" aria-labelledby="funnel-h">
        <h2 id="funnel-h" className="font-bold">Which jobs your agent applies to</h2>
        <p className="mt-1 text-sm text-muted">Add a target role and your agent shows how many live jobs fit it, and which ones it applies to.</p>
        <Link href="/app/targets" className="btn-primary mt-3 min-h-9 text-[13px]">Add a target role</Link>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="funnel-h" aria-busy={loading}>
      <div className="flex flex-wrap items-start gap-3 p-5 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="funnel-h" className="text-lg font-bold">Up next for your agent</h2>
          <p className="text-sm text-muted">
            {!data ? "Counting your matches…" : !enabled ? "Auto-apply is off — these wait until you turn it on, or press Apply on any of them in Live jobs."
              : today.length ? `${today.length} job${today.length > 1 ? "s" : ""} today, best matches first, one company at a time.`
                : left === 0 ? `Today's limit of ${limit} is used — it starts again tomorrow.` : "Nothing new passes every check right now — your agent looks again every 10 minutes."}
          </p>
        </div>
        <button className="btn-ghost min-h-9 text-[13px]" onClick={() => onReload(true)} disabled={loading} aria-label="Recount matches">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {data ? `Counted ${agoShort(Date.parse(data.computedAt), now)}` : "Count"}
        </button>
      </div>

      {failed && !data && <p className="px-5 pb-3 text-sm text-muted">Couldn&apos;t count your matches right now. <button className="font-semibold text-brand-ink" onClick={() => onReload(true)}>Try again</button></p>}

      {/* The jobs, in the agent's order */}
      <div className="px-5 pb-4">
        {!data ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>
        ) : data.upNext.length === 0 ? null : (
          <>
            <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {(showAll ? data.upNext : data.upNext.slice(0, 6)).map((j, i) => {
                const role = roles.find((r) => r.id === j.roleId);
                return (
                  <li key={j.id} className="flex items-center gap-3 px-3.5 py-3">
                    <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <a href={j.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold hover:text-brand-ink">{j.title}</a>
                      <span className="block truncate text-xs text-muted">{j.company}{j.location ? ` · ${j.location}` : ""}{role ? ` · ${role.title}` : ""}{j.posted ? ` · posted ${agoShort(Date.parse(j.posted), now)}` : ""}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs font-semibold tabular-nums text-green-ink sm:block">{j.score}%</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${j.today ? "bg-green-tint text-green-ink" : "bg-line-2 text-ink-2"}`}>{j.today ? "Today" : "Tomorrow+"}</span>
                  </li>
                );
              })}
            </ol>
            {data.upNext.length > 6 && <button className="mt-2 text-xs font-semibold text-brand-ink" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${data.upNext.length}`}</button>}
          </>
        )}
      </div>

      {/* Where they come from */}
      <div className="border-t border-line bg-canvas/40 px-5 py-4">
        <h3 className="text-sm font-bold">Why these jobs — and not the rest</h3>
        <p className="mt-0.5 text-xs text-muted">Every open job with your target titles, and each rule that leaves one out. Change a rule and the counts update.</p>
        <ol className="mt-3 overflow-hidden rounded-xl border border-line bg-white">
          {rows.map((r) => (
            <li key={r.label} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm ${r.kind === "result" ? "border-y border-line bg-brand-soft font-semibold" : r.kind === "total" ? "font-semibold" : "text-ink-2"}`}>
              <span className={`w-14 shrink-0 text-right tabular-nums ${r.kind === "minus" ? "text-muted" : r.kind === "result" ? "text-brand-ink" : ""}`}>
                {r.n === undefined ? <span className="skeleton inline-block h-4 w-10 align-middle" /> : `${r.kind === "minus" ? "−" : ""}${r.n.toLocaleString()}`}
              </span>
              <span className="min-w-0 flex-1">{r.label}</span>
              {r.action && (r.action.href
                ? <Link href={r.action.href} className="shrink-0 text-xs font-semibold text-brand-ink hover:underline">{r.action.label} →</Link>
                : <button className="shrink-0 rounded-md bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand-ink hover:bg-brand/15" onClick={() => void r.action!.run!()}>{r.action.label}</button>)}
            </li>
          ))}
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-green-tint/50 px-3.5 py-2.5 text-sm font-semibold">
            <span className="w-14 shrink-0 text-right tabular-nums text-green-ink">{data ? today.length : "—"}</span>
            <span className="min-w-0 flex-1">Applying today <span className="font-normal text-muted">— {left} of your {limit} left today{data && data.ready > today.length && left > 0 ? "; one company at a time" : ""}</span></span>
            <Link href="/app/settings#agent-mode" className="shrink-0 text-xs font-semibold text-brand-ink hover:underline">Daily limit →</Link>
          </li>
        </ol>
      </div>

      {/* By target */}
      <div className="border-t border-line">
        <button className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-sm font-semibold hover:bg-canvas/60" onClick={() => setShowTargets((v) => !v)} aria-expanded={showTargets}>
          By target <span className="font-normal text-muted">· {active.length} active</span>
          <ChevronDown size={16} className={`ml-auto text-muted transition ${showTargets ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {showTargets && (
          <ul className="space-y-2 px-5 pb-5">
            {active.map((r) => {
              const d = roleData.get(r.id);
              const mine = perRole.get(r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold capitalize">{r.title}</p>
                    <p className="truncate text-xs text-muted">{d ? `${d.live} match · ${d.ready} ready · ${d.planned} today` : "Counting…"}{mine ? ` · ${mine.applied} applied` : ""}{mine?.needs ? ` · ${mine.needs} need you` : ""}{r.levels.length ? ` · ${r.levels.join(", ")}` : ""}</p>
                  </div>
                  <label>
                    <span className="sr-only">Priority for {r.title}</span>
                    <select className={`input min-h-9 rounded-full border-0 py-0 text-[13px] font-semibold ${PRIORITY_TONE[priorityMeta(r.priority).value]}`} value={priorityMeta(r.priority).value} disabled={saving === r.id} onChange={(e) => void setPriority(r, Number(e.target.value))}>
                      {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </label>
                  <Link href={`/app/jobs?role=${r.id}`} className="rounded-md p-1.5 text-subtle hover:bg-canvas hover:text-brand-ink" aria-label={`See ${r.title} jobs in Live jobs`}><ArrowRight size={15} /></Link>
                </li>
              );
            })}
            <li className="text-xs text-muted">Top priority targets get 3 of every 6 applications, High 2, Normal 1. <Link href="/app/targets" className="font-semibold text-brand-ink">Edit targets</Link></li>
          </ul>
        )}
      </div>
    </section>
  );
}
