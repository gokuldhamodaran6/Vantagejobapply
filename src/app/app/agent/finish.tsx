"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Hand, Loader2, Mail, MonitorPlay, MousePointerClick, RotateCcw, Send, X } from "lucide-react";
import { initials, timeAgo, tintFor } from "@/lib/format";
import { statusLine, type AgentTask } from "@/lib/agent/status";
import { patch } from "./shared";

/**
 * "Finish in Vantage": the company's real careers page, live inside the app. The agent creates the account, reads the
 * email code and fills every page; the person watches, takes control whenever a step needs them, and approves Submit.
 */
const PROGRESS = ["Open", "Account", "Email code", "Fill", "Your Submit"] as const;
function progressOf(t: AgentTask) {
  if (t.status === "submitted") return 5;
  const kind = (t.needs as { kind?: string }[] | null)?.[0]?.kind;
  if (kind === "submit_gate") return 4;
  if (t.status === "waiting_code") return 2;
  const s = `${t.step || ""} ${(t.log || []).slice(-1)[0]?.text || ""}`.toLowerCase();
  if (/submit/.test(s)) return 4;
  if (/code|verif/.test(s)) return 2;
  if (/account|sign/.test(s)) return 1;
  if (/fill|question|answer|next step|page|resume/.test(s)) return 3;
  return t.status === "queued" ? 0 : 1;
}

type LiveState = { active: boolean; mode: "watch" | "you"; url: string };

export function FinishPanel({
  task, others, onClose, onOpen, onToast, onChange, renderAsk,
}: {
  task: AgentTask | null;
  others: AgentTask[];
  onClose: () => void;
  onOpen: (t: AgentTask) => void;
  onToast: (m: string) => void;
  onChange: () => void;
  renderAsk: (t: AgentTask) => ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [state, setState] = useState<LiveState>({ active: false, mode: "watch", url: "" });
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = useRef<string>("");
  const id = task?.id;
  const status = task?.status;
  const liveNow = Boolean(status && ["queued", "running", "waiting_code", "needs_human", "needs_user"].includes(status));

  // A signed link to the agent's browser, fetched when the job is (or is about to be) live.
  useEffect(() => {
    if (!id || !liveNow || src) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const get = async () => {
      const r = await fetch("/api/agent/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id }) }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (stop) return;
      if (r?.ok && d.url) {
        origin.current = new URL(d.url).origin;
        setSrc(`${d.url}?t=${encodeURIComponent(d.token)}&embed=1`);
        setLiveErr(null);
      } else {
        setLiveErr(d.error || "Connecting to your agent's browser…");
        timer = setTimeout(get, 4000);
      }
    };
    void get();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, liveNow, src]);
  useEffect(() => {
    setSrc(null);
    setState({ active: false, mode: "watch", url: "" });
  }, [id]);

  // The live page tells us who is in control and where it is.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!origin.current || e.origin !== origin.current) return;
      const m = (e.data as { vantageLive?: LiveState })?.vantageLive;
      if (m) setState({ active: Boolean(m.active), mode: m.mode === "you" ? "you" : "watch", url: m.url || "" });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  const setMode = useCallback((you: boolean) => {
    frame.current?.contentWindow?.postMessage({ vantageLive: { mode: you ? "you" : "watch" } }, origin.current || "*");
    setState((s) => ({ ...s, mode: you ? "you" : "watch" }));
  }, []);

  // Esc closes the panel only while watching (in control, Esc hands back inside the page).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && state.mode === "watch") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state.mode, onClose]);

  async function act(body: Record<string, unknown>, ok: string) {
    if (!task) return;
    setBusy(true);
    const r = await patch(task.id, body);
    setBusy(false);
    onToast(r.ok ? ok : r.error || "Something went wrong.");
    onChange();
  }

  if (!task) return null;
  const p = progressOf(task);
  const need = (task.needs as { kind?: string; label?: string }[] | null)?.[0];
  const gate = task.status === "needs_human" && need?.kind === "submit_gate";
  const handoff = task.status === "needs_human" && !gate;
  const ask = task.status === "needs_user";
  const done = task.status === "submitted";
  const stopped = ["failed", "manual", "cancelled"].includes(task.status);
  const nextUp = others.find((o) => o.id !== task.id && ["manual", "failed", "needs_human", "needs_user", "awaiting_approval"].includes(o.status));
  const you = state.mode === "you";

  return (
    <div className="fixed inset-0 z-50 flex bg-canvas" role="dialog" aria-modal="true" aria-label={`${task.job.company} — in your agent's browser`}>
      {/* the list stays in reach */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-r border-line bg-surface lg:flex" aria-label="Your jobs">
        <div className="border-b border-line px-4 py-4">
          <p className="text-lg font-bold">Your agent</p>
          <p className="text-xs text-muted">Open any job to finish it here</p>
        </div>
        <ul className="flex-1 space-y-1.5 overflow-auto p-2.5">
          {[task, ...others.filter((o) => o.id !== task.id)].slice(0, 30).map((o) => {
            const cur = o.id === task.id;
            return (
              <li key={o.id}>
                <button onClick={() => !cur && onOpen(o)} className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${cur ? "border-brand bg-brand-tint/60" : "border-line hover:bg-canvas"}`} aria-current={cur ? "true" : undefined}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={tintFor(o.job.company)}>{initials(o.job.company)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{o.job.title}</span>
                    <span className="block truncate text-xs text-muted">{o.job.company} · {cur ? "open here" : statusLine(o)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-2.5 p-2.5 sm:p-4">
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={tintFor(task.job.company)}>{initials(task.job.company)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{task.job.company} · {task.job.title}</p>
              <p className="truncate text-xs text-muted">{task.job.match ? `${task.job.match}% match · ` : ""}Tailored resume · on {task.job.company}&apos;s own careers site</p>
            </div>
            <ol className="hidden items-center gap-1 text-[11px] font-semibold xl:flex" aria-label="Progress">
              {PROGRESS.map((label, i) => (
                <li key={label} className={`rounded-full px-2.5 py-1 ${i < p ? "bg-green-tint text-green-ink" : i === p ? (i === 4 ? "bg-orange-tint text-orange-ink" : "bg-brand-tint text-brand-ink") : "bg-line-2 text-subtle"}`}>{i < p ? "✓ " : ""}{label}</li>
              ))}
            </ol>
            {src && !done && !stopped && (
              <button className={`min-h-10 rounded-lg px-3.5 text-sm font-semibold transition ${you ? "bg-brand text-white" : "bg-orange-tint text-orange-ink hover:bg-orange/20"}`} onClick={() => setMode(!you)} aria-pressed={you}>
                {you ? <><Send size={15} className="mr-1.5 inline" aria-hidden />Hand back</> : <><Hand size={15} className="mr-1.5 inline" aria-hidden />Take control</>}
              </button>
            )}
            <button className="rounded-lg p-2 hover:bg-canvas" aria-label="Close and go back to the list" onClick={onClose}><X size={20} /></button>
          </header>

          <div className="relative min-h-[420px] flex-1 bg-canvas">
            {src && !done && !stopped ? (
              <iframe ref={frame} src={src} title={`${task.job.company}'s careers page, live`} className="absolute inset-0 h-full w-full border-0 bg-white" allow="clipboard-read; clipboard-write" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                {done ? (
                  <><span className="flex h-14 w-14 items-center justify-center rounded-full bg-green text-white"><Check size={28} /></span><p className="text-xl font-bold">Applied — {task.job.company} confirmed it</p><p className="max-w-md text-sm text-muted">Saved to Applications with a screenshot of the confirmation. Vantage watches your inbox for their reply.</p></>
                ) : stopped ? (
                  <><p className="text-lg font-bold">{task.status === "cancelled" ? "Stopped — nothing was sent" : "Your agent stopped on this one"}</p><p className="max-w-lg text-sm text-muted">{statusLine(task)}</p></>
                ) : (
                  <><Loader2 size={26} className="animate-spin text-brand" /><p className="text-lg font-bold">Opening {task.job.company}&apos;s careers page…</p><p className="max-w-md text-sm text-muted">{task.status === "queued" ? "Your agent's browser starts in a few seconds (about a minute if it was asleep). You'll see the real page here." : liveErr || "Connecting…"}</p></>
                )}
              </div>
            )}
          </div>

          {/* what the agent is doing, and what it needs from you */}
          <div className={`flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 ${gate || handoff || ask ? "bg-orange-tint/40" : done ? "bg-green-tint/40" : "bg-brand-tint/30"}`} aria-live="polite">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${gate || handoff || ask ? "bg-orange" : done ? "bg-green" : "bg-brand"}`}>
              {done ? <Check size={18} /> : gate ? <Send size={17} /> : handoff ? <MousePointerClick size={17} /> : task.status === "waiting_code" ? <Mail size={17} /> : <MonitorPlay size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${gate || handoff || ask ? "text-orange-ink" : ""}`}>
                {gate ? "Everything is filled. Your Submit." : handoff ? "Your turn on the page" : ask ? "A question only you can answer" : done ? "Applied" : you ? "You're in control — your agent is paused" : statusLine(task)}
              </p>
              <p className="truncate text-xs text-muted">
                {gate ? "Check the page, then press its Submit button — or let your agent press it. Vantage marks it Applied only after the site confirms."
                  : handoff ? (task.step || need?.label || "").replace(/^Your turn:\s*/, "")
                  : ask ? "Answer below — it's saved for every future application — or type it straight on the page."
                  : task.status === "waiting_code" ? "Reading the security code from your inbox and entering it."
                  : done ? `Applied ${timeAgo(task.finished_at || task.updated_at)}`
                  : `${(task.log || []).slice(-1)[0]?.text || "Starting"} · ${timeAgo(task.updated_at)}`}
              </p>
            </div>
            {gate && <button className="btn-primary" disabled={busy} onClick={() => act({ action: "submit_ok" }, "Your agent is pressing Submit now.")}><Send size={16} /> Submit it for me</button>}
            {(gate || handoff) && <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Stopped — nothing was sent.")}>Don&apos;t send</button>}
            {handoff && !you && src && <button className="btn-pink" onClick={() => setMode(true)}><Hand size={16} /> Take control</button>}
            {stopped && task.status !== "cancelled" && !task.submit_clicked_at && <button className="btn-primary" disabled={busy} onClick={() => act({ action: "open_here" }, "Your agent is opening it again — watch here.")}><RotateCcw size={16} /> Try again here</button>}
            {(done || stopped) && nextUp && <button className="btn-primary" onClick={() => onOpen(nextUp)}>Next: {nextUp.job.company} →</button>}
            {(done || stopped) && <button className="btn-secondary" onClick={onClose}>Back to list</button>}
          </div>
          {ask && <div className="max-h-[45vh] overflow-auto border-t border-line bg-canvas p-3">{renderAsk(task)}</div>}
        </div>
      </main>
    </div>
  );
}
