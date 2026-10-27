"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Inbox as InboxIcon, Loader2, Mail, RefreshCw } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";

type Msg = { id: string; from_addr: string; from_name: string; subject: string; snippet: string; body: string; received_at: string; kind: string; code: string | null; link: string | null; company: string | null; application_id: string | null; read: boolean };

const KIND: Record<string, { label: string; tone: "green" | "red" | "orange" | "blue" | "pink" | "gray" }> = {
  interview: { label: "Interview", tone: "pink" },
  offer: { label: "Offer", tone: "green" },
  assessment: { label: "Assessment", tone: "orange" },
  received: { label: "Application received", tone: "green" },
  action: { label: "Action needed", tone: "orange" },
  in_review: { label: "Under review", tone: "gray" },
  rejection: { label: "Not moving forward", tone: "red" },
  verification: { label: "Verification", tone: "blue" },
  other: { label: "Other", tone: "gray" },
};
const TABS = [["all", "All"], ["interview", "Interviews"], ["assessment", "Assessments"], ["action", "Action needed"], ["received", "Confirmations"], ["verification", "Codes"], ["rejection", "Rejections"]] as const;

export default function InboxPage() {
  const { userId } = useMe();
  const [mail, setMail] = useState<{ address: string; status: string; last_sync_at: string | null; error: string | null } | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [m, i] = await Promise.all([
      s.from("mail_accounts").select("address,status,last_sync_at,error").maybeSingle(),
      s.from("inbox_messages").select("*").order("received_at", { ascending: false }).limit(200),
    ]);
    setMail((m.data as typeof mail) || null);
    setMsgs((i.data as Msg[]) || []);
  }, []);
  // Fresh on open and every 30 seconds while the page is visible — codes and replies show up without pressing anything.
  useEffect(() => {
    if (!userId) return;
    load();
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      await fetch("/api/mail", { method: "PUT" }).catch(() => null);
      if (!stop) load();
    };
    void tick();
    const i = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [userId, load]);

  async function sync() {
    setBusy(true);
    const r = await fetch("/api/mail", { method: "PUT" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setToast(r.ok ? (d.imported ? `${d.imported} new email${d.imported > 1 ? "s" : ""}` : "You're up to date") : d.error || "Sync failed");
    load();
  }

  function copy(t: string, id: string) {
    navigator.clipboard?.writeText(t);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const shown = (msgs || []).filter((m) => tab === "all" || m.kind === tab);

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={mail ? <>Your job email <b className="text-ink">{mail.address}</b>{mail.last_sync_at ? ` · checked ${timeAgo(mail.last_sync_at)}` : ""}</> : "Replies from employers, sorted and linked to your applications."}
        actions={mail ? <button className="btn-secondary" onClick={sync} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check now</button> : undefined}
      />
      {mail === null && (
        <EmptyState title="Connect your job email" body="Make a Gmail just for job hunting and connect it with an app password. Your agent uses it to sign up on careers sites, reads verification codes, and sorts every reply here." action={<Link href="/app/settings#job-email" className="btn-primary"><Mail size={16} /> Connect job email</Link>} />
      )}
      {mail?.status === "error" && <div className="card mb-4 border-red/30 bg-red-tint p-4 text-sm text-red-ink">We can&apos;t read your job email: {mail.error}. <Link href="/app/settings#job-email" className="font-semibold underline">Reconnect</Link></div>}
      {mail && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${tab === k ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>
                {l}{k !== "all" && msgs ? ` · ${msgs.filter((m) => m.kind === k).length}` : ""}
              </button>
            ))}
          </div>
          {msgs === null && <div className="skeleton h-60" />}
          {msgs && shown.length === 0 && <div className="card p-8 text-center text-sm text-muted"><InboxIcon className="mx-auto mb-2 text-subtle" /> Nothing here yet.</div>}
          <ul className="space-y-2">
            {shown.map((m) => (
              <li key={m.id} className="card overflow-hidden">
                <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas/60" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-bold text-brand-ink">{(m.company || m.from_name || m.from_addr || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{m.company || m.from_name || m.from_addr}</span><Badge tone={KIND[m.kind]?.tone || "gray"}>{KIND[m.kind]?.label || m.kind}</Badge>{m.application_id && <span className="text-xs text-green-ink">Linked to your application</span>}</span>
                    <span className="block truncate text-sm">{m.subject}</span>
                    <span className="block truncate text-xs text-muted">{m.snippet}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(m.received_at)}</span>
                </button>
                {(m.code || m.link) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                    {m.code && (
                      <button className="inline-flex items-center gap-2 rounded-lg bg-canvas px-3 py-1.5 font-mono text-base font-bold tracking-[0.25em]" onClick={() => copy(m.code!, m.id)} aria-label="Copy code">
                        {m.code} {copied === m.id ? <Check size={15} className="text-green" /> : <Copy size={15} className="text-subtle" />}
                      </button>
                    )}
                    {m.link && <a className="btn-secondary min-h-9 text-xs" href={m.link} target="_blank" rel="noopener noreferrer">Open verification link <ExternalLink size={13} /></a>}
                  </div>
                )}
                {open === m.id && <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-line bg-canvas/40 px-4 py-3 font-sans text-sm leading-relaxed text-ink-2">{m.body}</pre>}
              </li>
            ))}
          </ul>
        </>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
