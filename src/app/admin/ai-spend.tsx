"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Info, Loader2, Sparkles } from "lucide-react";
import { Badge, Segmented } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { AI_PRICES, FALLBACK_PRICE, PRICES_AS_OF } from "@/lib/ai-pricing";

/* ─────────── Types returned by public.admin_ai_usage ─────────── */
type Num = number | string | null;
type Day = { day: string; calls: number; failures: number; tokens: Num; cost: Num; submitted: number };
type Feature = { feature: string; calls: number; failures: number; input: Num; output: Num; cost: Num; avg_latency_ms: number | null; users: number };
type Model = { provider: string; model: string; calls: number; failures: number; input: Num; output: Num; cache_read: Num; cache_write: Num; thinking: Num; cost: Num; avg_latency_ms: number | null };
type UserRow = { user_id: string; email: string | null; full_name: string | null; calls: number; failures: number; input: Num; output: Num; cost: Num; last_at: string | null; top_feature: string | null; submitted: number };
type Usage = {
  from: string; to: string; tz: string; now: string; month_start: string; month_end: string; first_at: string | null;
  totals: { calls: number; failures: number; input: Num; output: Num; cache_read: Num; cache_write: Num; thinking: Num; cost: Num; users: number; avg_latency_ms: number | null; p95_latency_ms: number | null; unattributed_calls: number; unattributed_cost: Num; submitted: number };
  kpi: { today: Num; calls_today: number; d7: Num; d30: Num; mtd: Num; prev_month: Num; users_30d: number; submitted_30d: number; submitted_mtd: number };
  by_day: Day[]; by_feature: Feature[]; by_model: Model[]; by_user: UserRow[]; by_month: { month: string; cost: Num; calls: number }[];
};

const num = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v) || 0);

/** $0.0042 · $3.18 · $1,284 · $12.9K */
export function usd(v: Num | undefined, opts: { compact?: boolean } = {}) {
  const x = num(v);
  if (x === 0) return "$0";
  const a = Math.abs(x);
  if (a < 0.01) return `$${x.toFixed(4)}`;
  if (a < 100) return `$${x.toFixed(2)}`;
  if (opts.compact && a >= 10_000) return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x)}`;
  return `$${Math.round(x).toLocaleString("en-US")}`;
}
const compact = (v: Num | undefined) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(num(v));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : "—");
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/* ─────────── Date ranges ─────────── */
type Preset = "today" | "7d" | "30d" | "90d" | "month" | "last_month" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" },
  { value: "month", label: "This month" }, { value: "last_month", label: "Last month" }, { value: "custom", label: "Custom" },
];
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(p: Preset, custom: { from: string; to: string }): { from: Date; to: Date } {
  const now = new Date();
  const today = dayStart(now);
  const back = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  if (p === "today") return { from: today, to: now };
  if (p === "7d") return { from: back(6), to: now };
  if (p === "90d") return { from: back(89), to: now };
  if (p === "month") return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: now };
  if (p === "last_month") return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
  if (p === "custom" && custom.from && custom.to) {
    const [fy, fm, fd] = custom.from.split("-").map(Number);
    const [ty, tm, td] = custom.to.split("-").map(Number);
    const from = new Date(fy, fm - 1, fd);
    const to = new Date(ty, tm - 1, td + 1);
    return to > from ? { from, to } : { from: to, to: from };
  }
  return { from: back(29), to: now };
}

/* ─────────── CSV ─────────── */
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas in user-controlled text (names, emails).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const cols = rows.length ? Object.keys(rows[0]) : ["empty"];
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────── Pieces ─────────── */
function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4" title={hint}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <span>{label}: no data</span>;
  const d = (now - before) / before;
  // More spend is not "good": up is shown in orange, down in green — always with an arrow and words.
  const up = d >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? "text-orange-ink" : "text-green-ink"}`}>
      {up ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
      {Math.abs(d * 100).toFixed(0)}% {up ? "above" : "below"} {label}
    </span>
  );
}

type Metric = "cost" | "calls" | "tokens";

/** Daily columns: one series, brand blue, 4px rounded tops, hairline grid, per-bar tooltip on hover and focus. */
function DailyChart({ days, metric }: { days: Day[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = days.map((d) => (metric === "cost" ? num(d.cost) : metric === "calls" ? d.calls : num(d.tokens)));
  const max = Math.max(...vals, 0);
  const fmt = (v: number) => (metric === "cost" ? usd(v, { compact: true }) : compact(v));
  // Clean ticks: 0, ½, max rounded up to a "nice" number.
  const nice = (() => {
    if (max <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(max));
    const m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  })();
  const ticks = [0, nice / 2, nice];
  const H = 180, W = Math.max(days.length * 28, 320), left = 56, bottom = 22, top = 8;
  const slot = (W - left) / Math.max(1, days.length);
  const bw = Math.min(24, Math.max(3, slot - 2));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / nice);
  const labelEvery = Math.ceil(days.length / 8);
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg width={W} height={H} role="img" aria-label={`Daily AI ${metric}, ${days.length} days`} className="block min-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#eef0f4" strokeWidth={1} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">{fmt(t)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const v = vals[i];
            const x = left + i * slot + (slot - bw) / 2;
            const yy = y(v);
            const hgt = Math.max(0, H - bottom - yy);
            const r = Math.min(4, bw / 2, hgt);
            const path = hgt > 0 ? `M${x},${H - bottom} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${H - bottom} Z` : "";
            return (
              <g key={d.day}>
                {path && <path d={path} className={hover === i ? "fill-brand-ink" : "fill-brand"} />}
                {/* Hit target: the whole column slot, not just the painted bar. */}
                <rect
                  x={left + i * slot} y={top} width={slot} height={H - top - bottom} fill="transparent" tabIndex={0}
                  aria-label={`${d.day}: ${fmt(v)}${metric === "cost" ? `, ${d.calls} calls` : ""}`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  className="cursor-default outline-none"
                />
                {i % labelEvery === 0 && (
                  <text x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">{d.day.slice(5)}</text>
                )}
              </g>
            );
          })}
          <line x1={left} x2={W} y1={H - bottom} y2={H - bottom} stroke="#e6e8ef" strokeWidth={1} />
        </svg>
      </div>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, left + hover * slot - 60), W - 170) }}
        >
          <p className="font-semibold text-muted">{new Date(`${h.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p>
          <p className="mt-1 text-sm font-bold text-ink">{usd(h.cost)}</p>
          <p className="text-muted">{h.calls.toLocaleString()} calls · {compact(h.tokens)} tokens{h.failures ? ` · ${h.failures} failed` : ""}</p>
          <p className="text-muted">{h.submitted} applications submitted</p>
        </div>
      )}
    </div>
  );
}

/** Horizontal share bars for a breakdown (single hue; labels in text colours). */
function ShareBars({ rows, total }: { rows: { key: string; label: string; cost: number; detail: string }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.cost), 0) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums"><span className="font-semibold">{usd(r.cost)}</span> <span className="text-muted">· {pct(r.cost, total)}</span></span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-brand-tint"><div className="h-2 rounded-full bg-brand" style={{ width: `${(r.cost / max) * 100}%` }} /></div>
          <p className="mt-0.5 text-xs text-muted">{r.detail}</p>
        </li>
      ))}
    </ul>
  );
}

type SortKey = "user" | "calls" | "tokens" | "cost" | "submitted" | "per_app" | "last";

/** The admin "AI spend" section. `refresh` changes when the page's Refresh button is pressed. */
export function AiSpend({ refresh = 0 }: { refresh?: number }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState(() => ({ from: isoDate(new Date(Date.now() - 29 * 864e5)), to: isoDate(new Date()) }));
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [metric, setMetric] = useState<Metric>("cost");
  const [showTable, setShowTable] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cost", desc: true });
  const [userSearch, setUserSearch] = useState("");
  const [scaleUsers, setScaleUsers] = useState(1000);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const load = useCallback(async () => {
    setLoading(true);
    // Worked out at load time, so "today" and "last 7 days" always end now.
    const range = rangeFor(preset, custom);
    const { data: d, error: e } = await supabaseBrowser().rpc("admin_ai_usage", { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz });
    setLoading(false);
    if (e) setError(/admin_ai_usage|function/i.test(e.message) && /not find|does not exist/i.test(e.message) ? "The AI usage tables aren't in the database yet." : e.message);
    else {
      setError(null);
      setData(d as Usage);
    }
  }, [preset, custom, tz]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function exportCsv() {
    setExporting(true);
    const range = rangeFor(preset, custom);
    const { data: rows, error: e } = await supabaseBrowser().rpc("admin_ai_usage_rows", { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz });
    setExporting(false);
    if (e) return setError(e.message);
    downloadCsv(`vantage-ai-usage_${isoDate(range.from)}_${isoDate(new Date(range.to.getTime() - 1))}.csv`, (rows as Record<string, unknown>[]) || []);
  }

  const users = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = (data?.by_user || []).filter((u) => !q || `${u.email || ""} ${u.full_name || ""}`.toLowerCase().includes(q));
    const val = (u: UserRow): number | string => {
      switch (sort.key) {
        case "user": return (u.full_name || u.email || "").toLowerCase();
        case "calls": return u.calls;
        case "tokens": return num(u.input) + num(u.output);
        case "submitted": return u.submitted;
        case "per_app": return u.submitted ? num(u.cost) / u.submitted : -1;
        case "last": return u.last_at ? Date.parse(u.last_at) : 0;
        default: return num(u.cost);
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [data, sort, userSearch]);

  const k = data?.kpi;
  const t = data?.totals;
  const proj = useMemo(() => {
    if (!data || !k) return null;
    const start = Date.parse(data.month_start), end = Date.parse(data.month_end), now = Date.parse(data.now);
    const totalDays = (end - start) / 864e5;
    const elapsed = Math.max(1 / 24, (now - start) / 864e5);
    const remaining = Math.max(0, totalDays - elapsed);
    // Recent pace (last 7 days) for the rest of the month — reacts to growth faster than a straight-line average.
    const pace = num(k.d7) / 7;
    return { value: num(k.mtd) + pace * remaining, linear: (num(k.mtd) / elapsed) * totalDays, pace };
  }, [data, k]);

  const header = (key: SortKey, label: string, right = true) => (
    <th className={`px-4 py-2.5 font-semibold ${right ? "text-right" : ""}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "user" }))}>
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
      </button>
    </th>
  );

  const empty = data && !data.first_at;
  const rangeCost = num(t?.cost);
  const perApp = t?.submitted ? rangeCost / t.submitted : null;
  const perActiveUserMonth = k && k.users_30d ? num(k.d30) / k.users_30d : null;

  return (
    <div className="mt-6 space-y-6">
      {/* Filters: one row, date range first. They scope everything below except the fixed-period tiles. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Date range" value={preset} onChange={setPreset} options={PRESETS} />
        {preset === "custom" && (
          <div className="flex items-center gap-2 text-sm">
            <label className="sr-only" htmlFor="ai-from">From</label>
            <input id="ai-from" type="date" className="input !min-h-9 w-auto py-1 text-sm" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-muted">to</span>
            <label className="sr-only" htmlFor="ai-to">To</label>
            <input id="ai-to" type="date" className="input !min-h-9 w-auto py-1 text-sm" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        {loading && <Loader2 size={16} className="animate-spin text-muted" aria-label="Loading" />}
        <button className="btn-secondary ml-auto" onClick={exportCsv} disabled={exporting || !data || empty === true}>
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV
        </button>
      </div>

      {error && (
        <div className="card border-red-tint bg-red-tint/40 p-4 text-sm">
          <p className="font-semibold text-red-ink">Couldn&apos;t load AI usage</p>
          <p className="mt-1 text-ink-2">{error}</p>
        </div>
      )}

      {!data && !error && <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>}

      {empty && (
        <section className="card p-8 text-center">
          <Sparkles className="mx-auto text-brand" size={28} aria-hidden />
          <h2 className="mt-3 text-lg font-bold">No AI usage recorded yet</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted">
            Metering starts as soon as this version is deployed. Every Claude and Gemini request — tailoring, the form pilot, field plans,
            mail sorting, the assistant and resume writing — is logged with its user, feature, model, tokens, latency and estimated cost.
          </p>
        </section>
      )}

      {data && !empty && k && t && (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile label="Today" value={usd(k.today)} sub={`${k.calls_today.toLocaleString()} calls`} />
            <Tile label="Last 7 days" value={usd(k.d7)} sub={`${usd(num(k.d7) / 7)} a day on average`} />
            <Tile label="Last 30 days" value={usd(k.d30)} sub={`${k.users_30d} active users`} />
            <Tile label="Month to date" value={usd(k.mtd)} sub={<Delta now={num(k.mtd)} before={num(k.prev_month)} label="all of last month" />} />
            <Tile
              label="Projected this month" value={proj ? usd(proj.value) : "—"}
              sub={proj ? `at the last 7 days' pace · straight-line ${usd(proj.linear)}` : undefined}
              hint="Month-to-date spend plus the last 7 days' daily average for each remaining day of the month."
            />
            <Tile
              label="Cost per application" value={perApp !== null ? usd(perApp) : "—"}
              sub={t.submitted ? `${t.submitted.toLocaleString()} submitted in this range` : "No applications submitted in this range"}
              hint="All AI spend in the selected range divided by applications the agent or extension submitted in it."
            />
          </div>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Daily {metric === "cost" ? "spend" : metric}</h2>
                <p className="text-sm text-muted">
                  {usd(rangeCost)} · {t.calls.toLocaleString()} calls · {compact(num(t.input) + num(t.cache_read) + num(t.cache_write))} input / {compact(num(t.output) + num(t.thinking))} output tokens · days in {data.tz}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Segmented label="Chart metric" value={metric} onChange={setMetric} options={[{ value: "cost", label: "Cost" }, { value: "calls", label: "Calls" }, { value: "tokens", label: "Tokens" }]} />
                <button className="btn-ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>{showTable ? "Chart" : "Table"}</button>
              </div>
            </div>
            <div className="mt-4">
              {showTable ? (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#f9fafc] text-left text-xs text-muted"><tr>{["Day", "Cost", "Calls", "Failed", "Tokens", "Applications"].map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                    <tbody className="tabular-nums">
                      {data.by_day.map((d) => (
                        <tr key={d.day} className="border-t border-line">
                          <td className="px-3 py-1.5">{d.day}</td><td className="px-3 py-1.5 text-right font-semibold">{usd(d.cost)}</td><td className="px-3 py-1.5 text-right">{d.calls}</td>
                          <td className="px-3 py-1.5 text-right">{d.failures}</td><td className="px-3 py-1.5 text-right">{compact(d.tokens)}</td><td className="px-3 py-1.5 text-right">{d.submitted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <DailyChart days={data.by_day} metric={metric} />
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted">Failed requests</p><p className="font-semibold">{t.failures.toLocaleString()} <span className="font-normal text-muted">({pct(t.failures, t.calls)})</span></p></div>
              <div><p className="text-xs text-muted">Latency (avg · p95)</p><p className="font-semibold">{ms(t.avg_latency_ms)} · {ms(t.p95_latency_ms)}</p></div>
              <div><p className="text-xs text-muted">Users with AI usage</p><p className="font-semibold">{t.users}</p></div>
              <div><p className="text-xs text-muted">Not tied to a user</p><p className="font-semibold">{usd(t.unattributed_cost)} <span className="font-normal text-muted">({t.unattributed_calls} calls)</span></p></div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="font-semibold">By feature</h2>
              <p className="mb-4 text-sm text-muted">What the money is spent on.</p>
              {data.by_feature.length ? (
                <ShareBars total={rangeCost} rows={data.by_feature.map((f) => ({
                  key: f.feature, label: f.feature, cost: num(f.cost),
                  detail: `${f.calls.toLocaleString()} calls · ${usd(f.calls ? num(f.cost) / f.calls : 0)} per call · ${ms(f.avg_latency_ms)} avg · ${f.users} users${f.failures ? ` · ${f.failures} failed` : ""}`,
                }))} />
              ) : <p className="text-sm text-muted">No calls in this range.</p>}
            </section>
            <section className="card p-5">
              <h2 className="font-semibold">By model</h2>
              <p className="mb-4 text-sm text-muted">Where switching models would save the most.</p>
              {data.by_model.length ? (
                <ShareBars total={rangeCost} rows={data.by_model.map((m) => ({
                  key: `${m.provider}/${m.model}`, label: m.model, cost: num(m.cost),
                  detail: `${m.provider} · ${m.calls.toLocaleString()} calls · ${compact(m.input)} in / ${compact(num(m.output) + num(m.thinking))} out${num(m.cache_read) ? ` · ${compact(m.cache_read)} cached` : ""} · ${ms(m.avg_latency_ms)} avg${m.failures ? ` · ${pct(m.failures, m.calls)} failed` : ""}`,
                }))} />
              ) : <p className="text-sm text-muted">No calls in this range.</p>}
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <div className="mr-auto">
                <h2 className="font-semibold">By user</h2>
                <p className="text-sm text-muted">Spend and applications per person in this range. Click a column to sort.</p>
              </div>
              <input className="input max-w-xs" placeholder="Search by email or name" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} aria-label="Search users by AI spend" />
            </div>
            {users.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-[#f9fafc] text-left text-xs text-muted">
                    <tr>
                      {header("user", "User", false)}{header("calls", "Calls")}{header("tokens", "Tokens")}{header("cost", "Cost")}
                      {header("submitted", "Applications")}{header("per_app", "Cost / application")}
                      <th className="px-4 py-2.5 font-semibold">Top feature</th>{header("last", "Last AI use")}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {users.map((u) => (
                      <tr key={u.user_id} className="border-t border-line">
                        <td className="px-4 py-3"><p className="font-semibold">{u.full_name || "—"}</p><p className="text-xs text-muted">{u.email || u.user_id}</p></td>
                        <td className="px-4 py-3 text-right">{u.calls.toLocaleString()}{u.failures ? <span className="block text-xs text-muted">{u.failures} failed</span> : null}</td>
                        <td className="px-4 py-3 text-right">{compact(num(u.input) + num(u.output))}</td>
                        <td className="px-4 py-3 text-right font-semibold">{usd(u.cost)}<span className="block text-xs font-normal text-muted">{pct(num(u.cost), rangeCost)} of spend</span></td>
                        <td className="px-4 py-3 text-right">{u.submitted}</td>
                        <td className="px-4 py-3 text-right">{u.submitted ? usd(num(u.cost) / u.submitted) : "—"}</td>
                        <td className="px-4 py-3">{u.top_feature ? <Badge tone="gray">{u.top_feature}</Badge> : "—"}</td>
                        <td className="px-4 py-3 text-right text-muted">{u.last_at ? timeAgo(u.last_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="px-4 pb-5 text-sm text-muted">{userSearch ? "No users match." : "No AI usage tied to a user in this range."}</p>}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="font-semibold">Planning</h2>
              <p className="text-sm text-muted">Unit costs from the last 30 days, to size spend before you scale.</p>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-muted">Per active user, per month</dt><dd className="text-lg font-bold">{perActiveUserMonth !== null ? usd(perActiveUserMonth) : "—"}</dd></div>
                <div><dt className="text-xs text-muted">Per application (30 days)</dt><dd className="text-lg font-bold">{k.submitted_30d ? usd(num(k.d30) / k.submitted_30d) : "—"}</dd></div>
              </dl>
              <div className="mt-4 rounded-xl bg-canvas p-4 text-sm">
                <label htmlFor="scale-users" className="font-semibold">If Vantage had</label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input id="scale-users" type="number" min={1} step={100} className="input !min-h-9 w-32 py-1" value={scaleUsers} onChange={(e) => setScaleUsers(Math.max(1, Number(e.target.value) || 1))} />
                  <span>active users, AI would cost about</span>
                  <span className="text-lg font-bold">{perActiveUserMonth !== null ? usd(perActiveUserMonth * scaleUsers, { compact: true }) : "—"}</span>
                  <span className="text-muted">a month</span>
                </div>
                <p className="mt-2 text-xs text-muted">Assumes today&apos;s usage per user and today&apos;s prices. Heavy auto-apply users cost more than the average.</p>
              </div>
            </section>
            <section className="card p-5">
              <h2 className="font-semibold">Monthly history</h2>
              <p className="mb-4 text-sm text-muted">Last 12 months (older months come from the daily rollup).</p>
              {data.by_month.length ? (
                <ShareBars total={data.by_month.reduce((a, m) => a + num(m.cost), 0)} rows={data.by_month.map((m) => ({
                  key: m.month, label: new Date(`${m.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }), cost: num(m.cost),
                  detail: `${m.calls.toLocaleString()} calls`,
                }))} />
              ) : <p className="text-sm text-muted">No history yet.</p>}
            </section>
          </div>
        </div>
      )}

      <details className="card p-4 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Info size={16} aria-hidden /> How costs are estimated</summary>
        <p className="mt-2 text-muted">
          Each request&apos;s tokens are priced with the table in <code>src/lib/ai-pricing.ts</code> (prices as of {PRICES_AS_OF} — check them against the providers&apos;
          price pages; they can be overridden with the <code>AI_PRICES_JSON</code> env var). Retries and failed requests are counted as calls; Gemini thinking tokens are billed as output.
          Raw rows are kept 180 days, then rolled up per day.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="text-xs">
            <thead className="text-left text-muted"><tr>{["Model", "Input / 1M", "Output / 1M", "Cache read / 1M", "Cache write / 1M"].map((h) => <th key={h} className="py-1 pr-6 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="tabular-nums">
              {[...Object.entries(AI_PRICES), ["anything else", FALLBACK_PRICE] as const].map(([m, p]) => (
                <tr key={m} className="border-t border-line"><td className="py-1 pr-6">{m}</td><td className="pr-6">${p.input}</td><td className="pr-6">${p.output}</td><td className="pr-6">{p.cacheRead !== undefined ? `$${p.cacheRead}` : "—"}</td><td className="pr-6">{p.cacheWrite !== undefined ? `$${p.cacheWrite}` : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
