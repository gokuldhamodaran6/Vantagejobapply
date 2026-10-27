"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, FileText, Loader2, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { NEEDS_YOU, STATUS_META, statusLine, type AgentTask } from "@/lib/agent/status";
import type { TargetRole } from "@/lib/types";
import { patch, STAGE, type LightTask, type RetryRow } from "./shared";

type GroupKey = "all" | "needs" | "progress" | "browser" | "applied" | "failed";
const GROUPS: { key: GroupKey; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "needs", label: "Needs you", statuses: NEEDS_YOU },
  { key: "progress", label: "In progress", statuses: ["queued", "running", "waiting_code", "needs_human"] },
  { key: "browser", label: "In your browser", statuses: ["extension"] },
  { key: "applied", label: "Applied", statuses: ["submitted"] },
  { key: "failed", label: "Skipped / couldn't apply", statuses: ["failed", "cancelled"] },
];
type Range = "any" | "today" | "7d" | "30d";
const RANGES: { value: Range; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];
type Sort = "recent" | "oldest" | "match" | "company";
const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Latest activity" },
  { value: "oldest", label: "Oldest first" },
  { value: "match", label: "Best match" },
  { value: "company", label: "Company A–Z" },
];
const PAGE = 25;

function sinceOf(r: Range) {
  if (r === "any") return null;
  if (r === "today") return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  return new Date(Date.now() - (r === "7d" ? 7 : 30) * 864e5).toISOString();
}
/** Safe for PostgREST's or=() syntax. */
const cleanTerm = (s: string) => s.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export function Activity({
  index, version, roles, queuePos, stages, retry, busy, onRetry, onChange, onToast, initialGroup,
}: {
  index: LightTask[] | null;
  version: number;
  roles: TargetRole[];
  queuePos: Map<string, number>;
  stages: Map<string, string>;
  retry: { safe: RetryRow[]; held: RetryRow[] } | null;
  busy: boolean;
  onRetry: () => void;
  onChange: () => void;
  onToast: (m: string) => void;
  initialGroup?: GroupKey;
}) {
  const [group, setGroup] = useState<GroupKey>(initialGroup || "all");
  const [roleId, setRoleId] = useState("");
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const [range, setRange] = useState<Range>("any");
  const [sort, setSort] = useState<Sort>("recent");
  const [limit, setLimit] = useState(PAGE);
  const [rows, setRows] = useState<AgentTask[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const req = useRef(0);

  // Search as you type, without a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setTerm(cleanTerm(draft)), 300);
    return () => clearTimeout(t);
  }, [draft]);

  // A new filter starts from the first page.
  const filterKey = `${group}|${roleId}|${term}|${range}|${sort}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setLimit(PAGE);
  }

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    const s = supabaseBrowser();
    let q = s.from("agent_tasks").select("*", { count: "exact" });
    const statuses = GROUPS.find((g) => g.key === group)?.statuses;
    if (statuses) q = q.in("status", statuses);
    if (roleId) q = q.eq("job->>role_id", roleId);
    if (term) q = q.or(`job->>title.ilike.*${term}*,job->>company.ilike.*${term}*`);
    const since = sinceOf(range);
    if (since) q = q.gte("updated_at", since);
    if (sort === "recent") q = q.order("updated_at", { ascending: false });
    else if (sort === "oldest") q = q.order("updated_at", { ascending: true });
    else if (sort === "match") q = q.order("job->match", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false });
    else q = q.order("job->>company", { ascending: true }).order("updated_at", { ascending: false });
    q.range(0, limit - 1).then(({ data, count, error: e }) => {
      if (id !== req.current) return;
      setLoading(false);
      if (e) return setError(true);
      setError(false);
      setRows((data as AgentTask[]) || []);
      setTotal(count ?? 0);
    });
  }, [group, roleId, term, range, sort, limit, version]);

  // Chip counts follow the other filters, so they always add up to what you'd see.
  const counts = useMemo(() => {
    const since = sinceOf(range);
    const sinceMs = since ? Date.parse(since) : 0;
    const t = term.toLowerCase();
    const base = (index || []).filter((x) =>
      (!roleId || x.job?.role_id === roleId) &&
      (!t || `${x.job?.title || ""} ${x.job?.company || ""}`.toLowerCase().includes(t)) &&
      (!sinceMs || Date.parse(x.updated_at) >= sinceMs),
    );
    return Object.fromEntries(GROUPS.map((g) => [g.key, g.statuses ? base.filter((x) => g.statuses!.includes(x.status)).length : base.length])) as Record<GroupKey, number>;
  }, [index, roleId, term, range]);

  const filtered = Boolean(roleId || term || range !== "any" || group !== "all");
  const roleTitle = (t: AgentTask) => roles.find((r) => r.id === t.job.role_id)?.title || null;
  const clear = () => { setGroup("all"); setRoleId(""); setDraft(""); setTerm(""); setRange("any"); };

  return (
    <section className="mt-6" aria-labelledby="activity-h">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="activity-h" className="font-bold">Activity</h2>
          <p className="text-xs text-muted">Every job your agent has worked on, newest first. Updates by itself.</p>
        </div>
        {index && <p className="text-xs text-muted" aria-live="polite">{rows ? `Showing ${Math.min(rows.length, total)} of ${total}` : ""}</p>}
      </div>

      <div className="card mb-3 space-y-3 p-3 sm:p-4">
        <div role="group" aria-label="Filter by status" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              aria-pressed={group === g.key}
              onClick={() => setGroup(g.key)}
              className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition ${group === g.key ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-canvas"}`}
            >
              {g.label}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${group === g.key ? "bg-brand/10" : g.key === "needs" && counts.needs ? "bg-orange-tint text-orange-ink" : "bg-line-2 text-muted"}`}>{index ? counts[g.key] : "–"}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <label className="relative block">
            <span className="sr-only">Search company or job title</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input className="input min-h-10 pl-9 text-sm" placeholder="Search company or title" value={draft} onChange={(e) => setDraft(e.target.value)} />
            {draft && <button type="button" onClick={() => setDraft("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:bg-canvas" aria-label="Clear search"><X size={14} /></button>}
          </label>
          <label className="block">
            <span className="sr-only">Target role</span>
            <select className="input min-h-10 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">All targets</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.title}{r.active ? "" : " (paused)"}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Last activity</span>
            <select className="input min-h-10 text-sm" value={range} onChange={(e) => setRange(e.target.value as Range)}>
              {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Sort by</span>
            <select className="input min-h-10 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {retry && (retry.safe.length > 0 || retry.held.length > 0) && (group === "all" || group === "failed") && (
        <div className="card mb-3 border-brand/20 bg-brand-tint/30 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {retry.safe.length ? `${retry.safe.length} job${retry.safe.length > 1 ? "s" : ""} stopped before anything was sent — safe to retry` : "Nothing to retry safely"}
              </p>
              <p className="text-xs text-muted">Retry only puts back jobs that never reached Submit and that you haven&apos;t applied to (or been turned down for) — never ones you chose to skip. Each gets a freshly tailored resume, within your daily limit.</p>
            </div>
            {retry.safe.length > 0 && <button className="btn-primary min-h-9 text-[13px]" disabled={busy} onClick={onRetry}><RotateCcw size={15} /> Retry {retry.safe.length}</button>}
          </div>
          <details className="mt-3 text-[13px]">
            <summary className="cursor-pointer font-semibold text-brand-ink">See which jobs{retry.held.length ? ` · ${retry.held.length} won't be retried, and why` : ""}</summary>
            <ul className="mt-2 space-y-1">
              {retry.safe.map((r) => <li key={r.id} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-green" aria-hidden /><span className="min-w-0"><b>{r.title}</b> · {r.company}</span></li>)}
              {retry.held.map((r) => <li key={r.id} className="flex gap-2 text-muted"><X size={14} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0"><b className="text-ink-2">{r.title}</b> · {r.company} — {r.why}</span></li>)}
            </ul>
          </details>
        </div>
      )}

      {rows === null && !error && <div className="space-y-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16" />)}</div>}
      {error && (
        <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="flex-1">Couldn&apos;t load your activity. Check your connection.</span>
          <button className="btn-secondary min-h-9 text-[13px]" onClick={onChange}><RotateCcw size={14} /> Try again</button>
        </div>
      )}
      {rows && rows.length === 0 && !error && (
        filtered ? (
          <div className="card p-8 text-center">
            <p className="font-semibold">No applications match these filters</p>
            <p className="mt-1 text-sm text-muted">Try another status, target or date range.</p>
            <button className="btn-secondary mt-4 min-h-9 text-[13px]" onClick={clear}>Clear filters</button>
          </div>
        ) : (
          <div className="card p-8 text-center">
            <p className="font-semibold">Nothing here yet</p>
            <p className="mt-1 text-sm text-muted">Paste a job link above, or open <Link href="/app/jobs" className="font-semibold text-brand-ink">Live jobs</Link> and press “Apply with agent”.</p>
          </div>
        )
      )}
      {rows && rows.length > 0 && (
        <ul className={`space-y-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {rows.map((t) => <TaskRow key={t.id} t={t} role={roleTitle(t)} pos={queuePos.get(t.id)} stage={stages.get(t.id)} onChange={onChange} onToast={onToast} />)}
        </ul>
      )}
      {rows && rows.length < total && (
        <div className="mt-3 flex justify-center">
          <button className="btn-secondary min-h-10" disabled={loading} onClick={() => setLimit((n) => n + PAGE)}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : null} Load {Math.min(PAGE, total - rows.length)} more
          </button>
        </div>
      )}
    </section>
  );
}

function TaskRow({ t, role, pos, stage, onChange, onToast }: { t: AgentTask; role: string | null; pos?: number; stage?: string; onChange: () => void; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<string | null>(null);
  const meta = STATUS_META[t.status] || { label: t.status, tone: "gray" as const };
  useEffect(() => {
    if (!open || proof) return;
    supabaseBrowser().from("agent_proofs").select("image").eq("task_id", t.id).maybeSingle().then(({ data }) => setProof((data as { image: string } | null)?.image || null));
  }, [open, proof, t.id]);
  return (
    <li className="card overflow-hidden">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${t.status === "submitted" ? "bg-green-tint text-green-ink" : "bg-brand-tint text-brand-ink"}`}>
          {t.status === "submitted" ? <Check size={17} /> : meta.live ? <Loader2 size={16} className="animate-spin" /> : (t.job.company || "?").slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{t.job.title}</span>
          <span className="block truncate text-xs text-muted">{t.job.company}{role ? ` · ${role}` : ""} · {statusLine(t, pos)}</span>
        </span>
        <span className="hidden text-xs text-muted sm:block">{timeAgo(t.updated_at)}</span>
        <span className="hidden sm:inline-flex">{t.status === "submitted" && stage && STAGE[stage] ? <Badge tone={STAGE[stage].tone}>{STAGE[stage].label}</Badge> : <Badge tone={meta.tone}>{meta.label}</Badge>}</span>
        <ChevronDown size={16} className={`shrink-0 text-subtle transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line bg-canvas/40 px-4 py-4 md:grid-cols-[1fr_280px]">
          <div>
            <div className="mb-2 sm:hidden">{t.status === "submitted" && stage && STAGE[stage] ? <Badge tone={STAGE[stage].tone}>{STAGE[stage].label}</Badge> : <Badge tone={meta.tone}>{meta.label}</Badge>}</div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">What your agent did</p>
            {(() => {
              const log = t.log || [];
              // Each run starts with "Opening …": show this attempt, fold earlier ones away.
              let start = 0;
              log.forEach((l, i) => { if (/^Opening /.test(l.text)) start = i; });
              const current = t.status === "queued" && log.length ? [] : log.slice(start);
              const earlier = t.status === "queued" ? log : log.slice(0, start);
              return (
                <>
                  <ol className="mt-2 space-y-1.5 border-l border-line pl-4 text-sm">
                    {current.slice(-14).map((l, i) => (
                      <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" />{l.text} <span className="text-xs text-muted">· {timeAgo(l.at)}</span></li>
                    ))}
                    {t.status === "queued" && <li className="relative font-medium"><span className="absolute -left-[21px] top-1.5 h-2 w-2 animate-pulse rounded-full bg-brand" />{pos && pos > 1 ? `#${pos} in line — your agent applies one job at a time and starts this one automatically when its turn comes.` : "Next in line — starting automatically."}</li>}
                    {t.status === "cancelled" && <li className="relative text-muted"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-line-2" />{statusLine(t)}{t.finished_at ? ` · ${timeAgo(t.finished_at)}` : ""}.{t.submit_clicked_at ? "" : ` Nothing was sent to ${t.job.company}.`}</li>}
                    {t.status === "submitted" && <li className="relative font-semibold text-green-ink"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-green" />Submitted on {t.job.company}&apos;s site{proof ? " — the confirmation page is saved as proof" : (t.log || []).some((l) => /extension/i.test(l.text)) ? " with the Vantage extension, in your own browser (no screenshot)" : ""}. Their emails will appear in your Inbox.</li>}
                    {!log.length && t.status !== "queued" && <li className="text-muted">Waiting to start.</li>}
                  </ol>
                  {earlier.length > 0 && (
                    <details className="mt-2 text-xs text-muted">
                      <summary className="cursor-pointer font-semibold">Earlier attempt ({earlier.length} steps)</summary>
                      <ol className="mt-1 space-y-1 pl-4">{earlier.slice(-10).map((l, i) => <li key={i}>{l.text} · {timeAgo(l.at)}</li>)}</ol>
                    </details>
                  )}
                </>
              );
            })()}
            <div className="mt-4 flex flex-wrap gap-2">
              {t.status === "queued" && <button className="btn-primary min-h-9 text-xs" onClick={async () => { const r = await patch(t.id, { action: "apply_now" }); onToast(r.ok ? `${t.job.company} is next — starting now.` : r.error || "Couldn't move it."); onChange(); }}><Sparkles size={14} /> Apply now</button>}
              {(t.status === "failed" || (t.status === "cancelled" && t.cancel_reason !== "duplicate")) && !t.submit_clicked_at && <button className="btn-secondary min-h-9 text-xs" onClick={async () => { const r = await patch(t.id, { action: "apply_now" }); onToast(r.ok ? `${t.job.company} is back in line and goes next.` : r.error || "Couldn't re-apply."); onChange(); }}><RotateCcw size={13} /> {t.status === "cancelled" && t.cancel_reason !== "system" ? "Apply after all" : "Try again"}</button>}
              {t.status === "extension" && <button className="btn-primary min-h-9 text-xs" onClick={async () => { const r = await patch(t.id, { action: "submitted_myself" }); onToast(r.ok ? `${t.job.company} is in your Applications.` : r.error || "Couldn't save that."); onChange(); }}><Check size={14} /> I submitted it</button>}
              {t.status === "extension" && <button className="btn-ghost min-h-9 text-xs" onClick={async () => { const r = await patch(t.id, { action: "cancel" }); onToast(r.ok ? "Marked as not applied." : r.error || "Couldn't save that."); onChange(); }}>I didn&apos;t apply</button>}
              {t.resume_id && <a className="btn-secondary min-h-9 text-xs" href={`/api/resume/${t.resume_id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><FileText size={14} /> {t.status === "submitted" ? "Resume sent" : "Tailored resume"}</a>}
              {t.resume_id && t.cover_letter && <a className="btn-secondary min-h-9 text-xs" href={`/api/resume/${t.resume_id}/pdf?kind=cover&inline=1`} target="_blank" rel="noopener noreferrer">Cover letter</a>}
              <a className="btn-ghost min-h-9 text-xs" href={t.job.url || t.apply_url} target="_blank" rel="noopener noreferrer">Job posting <ExternalLink size={13} /></a>
              {["queued", "awaiting_approval"].includes(t.status) && <button className="btn-ghost min-h-9 text-xs" onClick={async () => { const r = await patch(t.id, { action: "cancel" }); onToast(r.ok ? `${t.job.company} skipped — nothing was sent.` : r.error || "Couldn't cancel."); onChange(); }}>Don&apos;t apply</button>}
              {t.application_id && <Link className="btn-ghost min-h-9 text-xs" href="/app/applications">Track it <ArrowRight size={13} /></Link>}
            </div>
            {t.resume_style && <p className="mt-3 text-xs text-muted">Resume style: {t.resume_style} · Letter tone: {t.letter_tone}</p>}
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><ShieldCheck size={13} /> Proof</p>
            {proof ? (
              <a href={`data:image/jpeg;base64,${proof}`} target="_blank" rel="noopener noreferrer"><img src={`data:image/jpeg;base64,${proof}`} alt={`Screenshot of the ${t.job.company} application`} className="mt-2 w-full rounded-lg border border-line" /></a>
            ) : (
              <p className="mt-2 text-xs text-muted">{t.status === "submitted" ? "No screenshot for this one — it was submitted in your own browser." : "When your agent submits, a screenshot of the confirmation page is saved here."}</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
