"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, Loader2, Mail, Server } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Cron = { job: string; active: boolean; status: string | null; at: string | null; fails_24h: number; message: string | null };
type Alert = { key: string; message: string; first_at: string; last_at: string; notified_at: string | null; resolved_at: string | null };
type Health = {
  at: string;
  worker: { state: string; ms?: number; current?: string | null; done?: number | null };
  email: { configured: boolean; to: string | null };
  queue: Record<string, number>;
  oldest_queued_min: number | null;
  stuck_running: number;
  last_24h: { submitted: number; failed: number; manual: number; needs_you: number };
  top_errors: { error: string; n: number }[];
  cron: Cron[];
  crawl: { stats_at: string | null; open_jobs: number | null; last_board_ok: string | null; boards_ok_1h: number; boards_failing: number };
  mail: { active: number; errors: number; stale: number };
  ai_1h: { calls: number; failed: number; last_error: string | null };
  blocked_sites: number;
  alerts: Alert[];
};
type Run = { id: string; job: { title: string; company: string; system?: string; form_read_ahead?: number | null }; ats: string; status: string; step: string | null; error: string | null; needs: number; unanswered: number; created_at: string; finished_at: string | null };

const Dot = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
  <span className={`inline-block size-2.5 shrink-0 rounded-full ${ok ? (warn ? "bg-orange" : "bg-green") : "bg-red-ink"}`} aria-hidden />
);

export function HealthPanel({ refresh }: { refresh: number }) {
  const [h, setH] = useState<Health | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/admin/health", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/admin/release-check", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (a && !a.error) setH(a as Health);
    setRuns((b?.runs as Run[]) || []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load, refresh]);

  async function releaseCheck() {
    setBusy(true);
    setNote(null);
    const r = await fetch("/api/admin/release-check", { method: "POST" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Couldn't start" };
    setBusy(false);
    setNote(r?.ok ? `Started ${d.started.length} dry runs: ${d.started.map((s: { system: string; company: string }) => `${s.system} (${s.company})`).join(", ")}` : d.error);
    load();
  }

  if (!h) return <div className="mt-6 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>;

  const open = h.alerts.filter((a) => !a.resolved_at);
  const workerOk = h.worker.state === "working" || h.worker.state === "idle";
  const workerAsleep = h.worker.state.startsWith("asleep");
  const queued = h.queue.queued || 0;
  const cronBad = h.cron.filter((c) => c.active && c.status === "failed");
  const crawlOk = Boolean(h.crawl.last_board_ok && Date.parse(h.at) - Date.parse(h.crawl.last_board_ok) < 2 * 3600_000);
  const aiBad = h.ai_1h.calls >= 5 && h.ai_1h.failed / h.ai_1h.calls >= 0.5;
  const tiles: { label: string; ok: boolean; warn?: boolean; value: string; sub: string }[] = [
    { label: "Agent worker", ok: workerOk || workerAsleep, warn: workerAsleep, value: workerOk ? (h.worker.state === "working" ? `Applying${h.worker.current ? ` · ${h.worker.current}` : ""}` : "Ready") : workerAsleep ? "Asleep" : h.worker.state, sub: workerAsleep ? "Wakes by itself on the next job (~50 s)" : `${h.worker.ms ?? "—"} ms to answer` },
    { label: "Application line", ok: !h.stuck_running && (h.oldest_queued_min ?? 0) < 30, warn: (h.oldest_queued_min ?? 0) >= 10, value: `${queued} waiting · ${h.queue.running || 0} running`, sub: h.oldest_queued_min ? `Oldest waiting ${h.oldest_queued_min} min` : "Nothing waiting" },
    { label: "Last 24 hours", ok: h.last_24h.failed <= h.last_24h.submitted, warn: h.last_24h.failed > 0, value: `${h.last_24h.submitted} sent`, sub: `${h.last_24h.failed} failed · ${h.last_24h.manual} handed to the person · ${h.last_24h.needs_you} waiting on them` },
    { label: "Scheduled jobs", ok: !cronBad.length, value: cronBad.length ? `${cronBad.length} failing` : `${h.cron.filter((c) => c.active).length} running fine`, sub: cronBad.map((c) => c.job.replace(/^vantage-/, "")).join(", ") || "All last runs succeeded" },
    { label: "Job crawl", ok: crawlOk, value: `${(h.crawl.open_jobs || 0).toLocaleString()} open jobs`, sub: `${h.crawl.boards_ok_1h.toLocaleString()} feeds read in the last hour · last ${timeAgo(h.crawl.last_board_ok) || "never"}` },
    { label: "Mailbox sync", ok: !h.mail.stale && !h.mail.errors, value: `${h.mail.active} connected`, sub: h.mail.stale || h.mail.errors ? `${h.mail.stale} behind · ${h.mail.errors} with errors` : "Codes arrive within minutes" },
    { label: "AI (last hour)", ok: !aiBad, warn: h.ai_1h.failed > 0, value: `${h.ai_1h.calls} calls`, sub: h.ai_1h.failed ? `${h.ai_1h.failed} failed${h.ai_1h.last_error ? ` · ${h.ai_1h.last_error}` : ""}` : "No failures" },
    { label: "Sites that refused automation", ok: true, value: String(h.blocked_sites), sub: "The agent stays away; people apply there with the extension" },
  ];

  return (
    <div className="mt-6 space-y-6">
      <section className={`card flex flex-wrap items-center gap-3 p-4 ${open.length ? "border-red-ink/40" : ""}`}>
        {open.length ? <AlertTriangle className="text-red-ink" size={20} aria-hidden /> : <CheckCircle2 className="text-green-ink" size={20} aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{open.length ? `${open.length} thing${open.length > 1 ? "s" : ""} need${open.length > 1 ? "" : "s"} a look` : "Everything is running"}</p>
          <p className="text-xs text-muted">Checked every 10 minutes · updated {timeAgo(h.at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${h.email.configured ? "bg-green-tint text-green-ink" : "bg-canvas text-muted"}`}>
          <Mail size={12} aria-hidden /> {h.email.configured ? `Alerts emailed to ${h.email.to}` : "Email alerts off — set RESEND_API_KEY and ALERT_EMAIL on the app"}
        </span>
      </section>

      {h.alerts.length > 0 && (
        <section className="card divide-y divide-line">
          {h.alerts.map((a) => (
            <div key={a.key} className="flex items-start gap-3 p-4">
              <Dot ok={Boolean(a.resolved_at)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.message}</p>
                <p className="text-xs text-muted">{a.resolved_at ? `Recovered ${timeAgo(a.resolved_at)}` : `Since ${timeAgo(a.first_at)}`}{a.notified_at ? " · emailed" : ""}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="flex items-center gap-2 text-sm text-muted"><Dot ok={t.ok} warn={t.warn} /> {t.label}</p>
            <p className="mt-1.5 truncate text-lg font-bold">{t.value}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold">Why runs stopped (24 h)</h2>
          {h.top_errors.length === 0 ? <p className="mt-3 text-sm text-muted">No failed or handed-over runs.</p> : (
            <ul className="mt-3 space-y-2">
              {h.top_errors.map((e) => (
                <li key={e.error} className="flex items-start gap-3 text-sm"><span className="w-7 shrink-0 text-right font-bold tabular-nums">{e.n}</span><span className="text-ink-2">{e.error || "—"}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Scheduled jobs</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {h.cron.filter((c) => c.active).map((c) => (
              <li key={c.job} className="flex items-center gap-3 py-2">
                <Dot ok={c.status !== "failed"} warn={c.fails_24h > 0} />
                <span className="min-w-0 flex-1 truncate">{c.job.replace(/^vantage-/, "")}</span>
                <span className="text-xs text-muted">{c.fails_24h ? `${c.fails_24h} failed today · ` : ""}{timeAgo(c.at) || "not run yet"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-semibold"><FlaskConical size={18} aria-hidden /> Release check</h2>
            <p className="mt-1 text-sm text-muted">After an update, the agent does a dry run on one fresh real job per careers system. It fills the first page and stops — it never creates an account and never presses Submit. Greenhouse, Lever and Ashby forms are also read ahead.</p>
          </div>
          <button className="btn-primary shrink-0" onClick={releaseCheck} disabled={busy || Boolean(runs?.some((r) => ["queued", "running"].includes(r.status)))}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Server size={16} />} Run release check
          </button>
        </div>
        {note && <p className="mt-3 rounded-xl bg-canvas p-3 text-sm">{note}</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted"><tr>{["System", "Job", "Form read ahead", "Result", "When"].map((x) => <th key={x} className="py-2 pr-4 font-semibold">{x}</th>)}</tr></thead>
            <tbody>
              {(runs || []).map((r) => {
                const working = ["queued", "running"].includes(r.status);
                const good = r.status === "manual" && /^Dry run: stopped before/.test(r.step || "") && !r.unanswered;
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-2.5 pr-4 font-medium">{r.job.system || r.ats}</td>
                    <td className="py-2.5 pr-4"><p className="max-w-[16rem] truncate">{r.job.title}</p><p className="text-xs text-muted">{r.job.company}</p></td>
                    <td className="py-2.5 pr-4 text-xs">{r.job.form_read_ahead === null || r.job.form_read_ahead === undefined ? <span className="text-muted">—</span> : r.job.form_read_ahead < 0 ? <span className="text-red-ink">Couldn&apos;t read</span> : `${r.job.form_read_ahead} questions`}</td>
                    <td className="py-2.5 pr-4">
                      <p className="flex items-start gap-2">
                        {working ? <CircleDashed size={14} className="mt-0.5 shrink-0 animate-spin text-muted" aria-hidden /> : <Dot ok={good || r.status === "manual"} warn={!good} />}
                        <span>{working ? r.step || "Waiting to start" : r.step || r.error || r.status}</span>
                      </p>
                      {!working && r.needs > 0 && <p className="mt-0.5 text-xs text-muted">{r.needs} fields read{r.unanswered ? ` · ${r.unanswered} it couldn't answer` : ""}</p>}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted">{timeAgo(r.created_at)}</td>
                  </tr>
                );
              })}
              {runs?.length === 0 && <tr><td colSpan={5} className="py-4 text-sm text-muted">No release checks in the last 7 days.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
