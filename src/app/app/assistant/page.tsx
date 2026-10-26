"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUp, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/brand";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import type { Change } from "@/lib/assistant";

type Msg = { role: "user" | "assistant"; content: string; data?: { apps?: { id: string; title: string; company: string; status: string; when: string | null }[]; changes?: Change[] }; done?: boolean };

const PROMPTS = ["What did you apply to today?", "Any interviews this week?", "Also target Product Analyst roles", "UK sponsorship rules"];

function rich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

function Chat() {
  const { userId, refresh } = useMe();
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

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setBusy(true);
    const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t }) });
    const d = await r.json();
    setBusy(false);
    setMsgs((m) => [...m, { role: "assistant", content: d.text || d.error || "Something went wrong.", data: { apps: d.apps, changes: d.changes } }]);
  }

  async function confirm(idx: number, changes: Change[]) {
    setBusy(true);
    const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: changes }) });
    const d = await r.json();
    setBusy(false);
    setMsgs((m) => [...m.map((x, i) => (i === idx ? { ...x, done: true } : x)), { role: "assistant", content: d.text || d.error }]);
    refresh();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-[26px] font-bold tracking-tight">Ask your agent</h1>
        <p className="mt-1 text-[15px] text-muted">Ask about any application, or tell it what to target. Big changes are shown to you before they happen.</p>
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
            placeholder="Ask about an application, or tell your agent what to target…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            aria-label="Message your agent"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40" disabled={!input.trim() || busy} aria-label="Send"><ArrowUp size={18} /></button>
        </div>
      </form>
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
