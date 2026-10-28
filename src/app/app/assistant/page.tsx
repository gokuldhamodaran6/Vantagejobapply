"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUp, ArrowUpRight, Loader2, MapPin } from "lucide-react";
import { PrepareDrawer } from "@/components/prepare-drawer";
import { matchJob } from "@/lib/jobs/match";
import type { Job, MatchResult } from "@/lib/types";
import { LogoMark } from "@/components/brand";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import type { Change, JobCard } from "@/lib/assistant";

type Msg = { role: "user" | "assistant"; content: string; data?: { apps?: { id: string; title: string; company: string; status: string; when: string | null }[]; changes?: Change[]; jobs?: JobCard[] }; done?: boolean };

const PROMPTS = ["Which applications need a follow-up?", "What did I apply to this week?", "Find product manager jobs in Texas", "Any interviews this week?", "Also target Product Analyst roles", "How do I improve my interview rate?"];

function rich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

function Chat() {
  const { userId, refresh, roles, prefs, auth } = useMe();
  const [prep, setPrep] = useState<{ job: Job; match: MatchResult } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const params = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    if (!userId) return;
    supabaseBrowser().from("chat_messages").select("role,content,data").order("created_at", { ascending: false }).limit(30).then(({ data }) => {
      setMsgs(((data as Msg[]) || []).reverse().map((m) => ({ ...m, done: true })));
      const q = params.get("q");
      if (q && !sentInitial.current) {
        sentInitial.current = true;
        send(q);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Newer browsers return a Promise from scrollIntoView; an effect must never return it (React would call it as cleanup).
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setBusy(true);
    let d: { text?: string; error?: string; apps?: Msg["data"] extends infer X ? X extends { apps?: infer A } ? A : never : never; changes?: Change[]; jobs?: JobCard[] } = {};
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t }) });
      d = await r.json().catch(() => ({ error: r.status === 401 ? "Your session expired. Refresh the page and log in again." : "I couldn't read the reply. Try again." }));
    } catch {
      d = { error: "You seem to be offline. Check your connection and try again." };
    }
    setBusy(false);
    setMsgs((m) => [...m, { role: "assistant", content: d.text || d.error || "Something went wrong.", data: { apps: d.apps, changes: d.changes, jobs: d.jobs } }]);
  }

  async function confirm(idx: number, changes: Change[]) {
    setBusy(true);
    const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: changes }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setBusy(false);
    setMsgs((m) => [...m.map((x, i) => (i === idx ? { ...x, done: true } : x)), { role: "assistant", content: d.text || d.error || "Done." }]);
    refresh();
  }

  /** Open a job from the chat in the Tailor & apply drawer. */
  async function openJob(j: JobCard) {
    setOpening(j.id);
    const r = await fetch(`/api/jobs/${encodeURIComponent(j.id)}`).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    setOpening(null);
    const job = d?.job as Job | undefined;
    if (!job) return setMsgs((m) => [...m, { role: "assistant", content: `Couldn't open ${j.title} at ${j.company} — it may have closed.` }]);
    setPrep({ job, match: matchJob(job, { roles, prefs, auth }) });
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-[26px] font-bold tracking-tight">Ask Vantage</h1>
        <p className="mt-1 text-[15px] text-muted">Ask anything about your search, find jobs, or change what you&apos;re targeting. Big changes are shown to you before they happen.</p>
      </div>

      <div className="flex-1 space-y-5 pb-6">
        {msgs.length === 0 && !busy && (
          <div className="card p-6 text-center">
            <p className="font-semibold">Try asking</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {PROMPTS.map((p) => <button key={p} onClick={() => send(p)} className="rounded-full border border-line px-3.5 py-2 text-sm font-medium hover:bg-canvas">{p}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-3 text-[15px] text-white">{m.content}</motion.div>
          ) : (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
              <span className="mt-0.5 shrink-0"><LogoMark size={28} /></span>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-[15px] leading-relaxed">{rich(m.content)}</p>
                {!!m.data?.apps?.length && (
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                    {m.data.apps.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1"><span className="font-semibold">{a.title}</span> <span className="text-muted">· {a.company}</span></span>
                        <span className="chip bg-brand-tint text-brand-ink">{a.status}</span>
                        <span className="text-xs text-muted">{timeAgo(a.when)}</span>
                      </li>
                    ))}
                    <li><Link href="/app/applications" className="block bg-canvas px-4 py-2.5 text-sm font-semibold text-brand-ink">Open Applications</Link></li>
                  </ul>
                )}
                {!!m.data?.jobs?.length && (
                  <div className="mt-3 space-y-2">
                    {m.data.jobs.map((j) => (
                      <div key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{j.title}</p>
                          <p className="flex items-center gap-1 truncate text-xs text-muted">{j.company}{j.location ? <><MapPin size={11} /> {j.location}</> : null} · {j.score}% match</p>
                        </div>
                        <a href={j.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-ink">View</a>
                        <button className="btn-primary min-h-8 text-xs" disabled={opening === j.id} onClick={() => void openJob(j)}>{opening === j.id ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={13} />} Tailor &amp; apply</button>
                      </div>
                    ))}
                  </div>
                )}
                {!!m.data?.changes?.length && !m.done && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-primary" disabled={busy} onClick={() => confirm(i, m.data!.changes!)}>Apply these changes</button>
                    <Link href="/app/targets" className="btn-secondary">Review in My targets</Link>
                  </div>
                )}
              </div>
            </motion.div>
          ),
        )}
        {busy && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Working on it…</div>}
        <div ref={bottom} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-20 rounded-2xl border border-[#d5d9e2] bg-white p-2.5 shadow-[0_8px_24px_rgba(16,24,40,0.08)] lg:bottom-4">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-subtle"
            placeholder="Ask about an application, or change what you're targeting…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            aria-label="Message Vantage"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40" disabled={!input.trim() || busy} aria-label="Send"><ArrowUp size={18} /></button>
        </div>
      </form>
      <PrepareDrawer item={prep} onClose={() => setPrep(null)} onSaved={(msg) => setMsgs((m) => [...m, { role: "assistant", content: msg }])} />
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96" />}>
      <Chat />
    </Suspense>
  );
}
