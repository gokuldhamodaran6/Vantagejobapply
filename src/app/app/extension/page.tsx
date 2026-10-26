"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, MousePointerClick, PenLine, ShieldCheck, Trash2, Zap } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { timeAgo } from "@/lib/format";

/** The extension's fixed ID (from the public key in its manifest). */
const EXT_ID = "emeljhngmongcbfjioceeegbfamjdbpn";
type Key = { id: string; label: string; created_at: string; last_used_at: string | null };
type ChromeRuntime = { sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: { message?: string } };
const runtime = (): ChromeRuntime | null => (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime || null;

function ask(msg: unknown): Promise<{ ok?: boolean; connected?: boolean } | null> {
  const rt = runtime();
  if (!rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(EXT_ID, msg, (r) => resolve(rt.lastError ? null : (r as { ok?: boolean }) || null));
    } catch {
      resolve(null);
    }
    setTimeout(() => resolve(null), 1500);
  });
}

export default function ExtensionPage() {
  const [ext, setExt] = useState<{ installed: boolean; connected: boolean } | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const check = useCallback(async () => {
    const r = await ask({ type: "ping" });
    setExt({ installed: Boolean(r?.ok), connected: Boolean(r?.connected) });
    const k = await fetch("/api/ext/connect").then((x) => x.json()).catch(() => ({ keys: [] }));
    setKeys(k.keys || []);
  }, []);
  useEffect(() => {
    void check();
    const i = setInterval(check, 4000);
    return () => clearInterval(i);
  }, [check]);

  async function connect() {
    setBusy(true);
    const r = await fetch("/api/ext/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "Chrome" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setBusy(false);
      return setToast(d.error || "Couldn't connect.");
    }
    const ok = await ask({ type: "connect", token: d.token });
    setBusy(false);
    setToast(ok?.ok ? "Connected! Open any job application and click “Fill with Vantage”." : "Install the extension first (step 1), then press Connect again.");
    void check();
  }

  async function revoke(id: string) {
    await fetch(`/api/ext/connect?id=${id}`, { method: "DELETE" });
    setToast("Disconnected that browser.");
    void check();
  }

  const step = !ext?.installed ? 1 : !ext.connected ? 2 : 3;
  return (
    <>
      <PageHeader title="Vantage for Chrome" subtitle="Fill any job application in one click — on the company's own page, with your answers and a resume written for that job. You review it and press Submit yourself." />

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          { icon: MousePointerClick, title: "One click on any careers site", body: "Greenhouse, Lever, Ashby, Workday, iCIMS, Amazon and company sites — a “Fill with Vantage” button appears on the form." },
          { icon: PenLine, title: "Tailored for this job", body: "Vantage writes a resume and cover letter for the posting, uploads them, and answers “why are you a fit” questions in your voice." },
          { icon: Zap, title: "Tracked automatically", body: "When you submit, the job lands in Applications. Replies and interview invites from the company appear in your Inbox and Interviews." },
        ].map((c) => (
          <div key={c.title} className="card p-5">
            <c.icon size={20} className="text-brand" />
            <p className="mt-3 font-semibold">{c.title}</p>
            <p className="mt-1 text-sm text-muted">{c.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 card p-6">
        <h2 className="text-lg font-bold">Set it up — 2 minutes</h2>
        <ol className="mt-4 space-y-4">
          <li className="flex gap-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step > 1 ? "bg-green text-white" : "bg-brand text-white"}`}>{step > 1 ? <Check size={15} /> : 1}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Add the extension to Chrome</p>
              {step > 1 ? <p className="text-sm text-green-ink">Installed.</p> : (
                <>
                  <p className="mt-1 text-sm text-muted">Download it, unzip the file, open <code className="rounded bg-canvas px-1">chrome://extensions</code>, switch on <b>Developer mode</b> (top right), click <b>Load unpacked</b> and pick the unzipped folder. (A one-click Chrome Web Store version is on the way.)</p>
                  <a href="/vantage-extension.zip" download className="btn-primary mt-3 min-h-9 text-[13px]"><Download size={15} /> Download the extension</a>
                </>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step > 2 ? "bg-green text-white" : step === 2 ? "bg-brand text-white" : "bg-line-2 text-ink-2"}`}>{step > 2 ? <Check size={15} /> : 2}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Connect it to your account</p>
              {step > 2 ? <p className="text-sm text-green-ink">Connected — this browser fills with your Vantage profile.</p> : (
                <>
                  <p className="mt-1 text-sm text-muted">One click. The extension gets a private key for your account; it never sees your password.</p>
                  <button className="btn-primary mt-3 min-h-9 text-[13px]" disabled={busy || step < 2} onClick={connect}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Connect this browser</button>
                </>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step === 3 ? "bg-brand text-white" : "bg-line-2 text-ink-2"}`}>3</span>
            <div>
              <p className="font-semibold">Open a job application and click “Fill with Vantage”</p>
              <p className="mt-1 text-sm text-muted">Or click the Vantage icon in your toolbar. Anything new it asks you once, then remembers. Likely ghost jobs are flagged in red before you spend time on them.</p>
            </div>
          </li>
        </ol>
      </section>

      {keys.length > 0 && (
        <section className="mt-5 card p-5">
          <h2 className="font-bold">Connected browsers</h2>
          <ul className="mt-3 divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">{k.label} · connected {timeAgo(k.created_at)}{k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : ""}</span>
                <button className="btn-ghost min-h-8 text-xs" onClick={() => revoke(k.id)}><Trash2 size={13} /> Disconnect</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-4 text-xs text-muted">Privacy: the extension only reads a page when you press Fill, only sends that page&apos;s questions and job details to Vantage, and never presses Submit for you.</p>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
