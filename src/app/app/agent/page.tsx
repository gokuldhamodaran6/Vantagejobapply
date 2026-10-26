"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, ExternalLink, FileText, Link2, Loader2, Mail, MonitorPlay, RotateCcw, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Badge, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { ACTIVE, NEEDS_YOU, STATUS_META, type AgentTask } from "@/lib/agent/status";

type Setup = { mailbox: { address: string; status: string } | null; profileDone: boolean; consent: boolean; hasResume: boolean };

export default function AgentPage() {
  const { userId, profile, refresh } = useMe();
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "applied" | "active" | "problems">("all");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [t, m, a, r] = await Promise.all([
      s.from("agent_tasks").select("*").order("updated_at", { ascending: false }).limit(300),
      s.from("mail_accounts").select("address,status").maybeSingle(),
      s.from("applicant_profiles").select("*").maybeSingle(),
      s.from("resumes").select("id", { count: "exact", head: true }),
    ]);
    setTasks((t.data as AgentTask[]) || []);
    setNow(Date.now());
    const ap = a.data as Record<string, unknown> | null;
    setSetup({
      mailbox: (m.data as Setup["mailbox"]) || null,
      profileDone: Boolean(ap && ap.phone && ap.city && ap.country),
      consent: Boolean(ap?.agent_consent),
      hasResume: (r.count || 0) > 0,
    });
  }, []);

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  // Poll quickly while the agent is working, slowly otherwise.
  const working = (tasks || []).some((t) => ACTIVE.includes(t.status));
  useEffect(() => {
    if (!userId) return;
    const id = setInterval(load, working ? 4000 : 20000);
    return () => clearInterval(id);
  }, [userId, working, load]);

  async function applyLink() {
    if (!/^https?:\/\//i.test(link.trim())) return setToast("Paste the full job link, starting with https://");
    setBusy(true);
    const r = await fetch("/api/agent/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: link.trim() }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setBusy(false);
    if (!r?.ok) return setToast(d.error || "Couldn't start that application.");
    setLink("");
    setToast(`Preparing ${d.job.title} at ${d.job.company} — tailored resume and cover letter, then applying.`);
    load();
  }

  const all = useMemo(() => tasks || [], [tasks]);
  const needs = all.filter((t) => NEEDS_YOU.includes(t.status) || (t.status === "waiting_code" && !setup?.mailbox));
  const today = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const appliedToday = all.filter((t) => t.status === "submitted" && Date.parse(t.finished_at || t.updated_at) >= today).length;
  const week = all.filter((t) => t.status === "submitted" && Date.parse(t.finished_at || t.updated_at) >= now - 7 * 864e5).length;
  const inQueue = all.filter((t) => ACTIVE.includes(t.status)).length;
  const shown = all.filter((t) =>
    filter === "all" ? true : filter === "applied" ? t.status === "submitted" : filter === "active" ? ACTIVE.includes(t.status) || t.status === "awaiting_approval" : ["failed", "manual", "cancelled"].includes(t.status),
  );
  const steps = setup
    ? [
        { done: setup.hasResume, title: "Upload your resume", body: "Your agent writes a tailored copy for every job.", href: "/app/resumes", icon: FileText },
        { done: Boolean(setup.mailbox), title: "Connect your job email", body: "A Gmail just for job hunting. Codes and replies land there.", href: "/app/settings#job-email", icon: Mail },
        { done: setup.profileDone && setup.consent, title: "Finish your application profile", body: "Address, phone, links and your permission to accept privacy notices.", href: "/app/settings#application-profile", icon: UserRound },
      ]
    : [];
  const setupLeft = steps.filter((s) => !s.done).length;
  const ready = setup ? setup.hasResume && setup.profileDone && setup.consent : false;

  async function toggleAuto(on: boolean) {
    if (on && !ready) return setToast("Finish the setup steps first — your agent only applies once your profile, consent and resume are in place.");
    const { error } = await supabaseBrowser().from("profiles").update({ agent_enabled: on }).eq("id", userId!);
    if (error) return setToast(error.message);
    await refresh();
    setToast(on ? "Auto-apply is on. Your agent will apply to your best new matches through the day." : "Auto-apply is off. Your agent only applies when you press Apply.");
  }

  return (
    <>
      <PageHeader
        title="Your agent"
        subtitle="Applies on companies' official careers sites with a resume and cover letter written for each job. You only step in when a site needs a human."
        actions={<Link href="/app/settings#agent-mode" className="btn-secondary">{profile?.autonomy === "fully_automatic" ? "Fully automatic" : profile?.autonomy === "approve_all" ? "Approve every application" : "Approve important ones"}</Link>}
      />

      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-brand/15 via-pink/10 to-orange/10 blur-2xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-ink"><Link2 size={16} /> Apply from any job link</p>
          <h2 className="mt-1 text-xl font-bold">Paste a job from a company&apos;s careers site — your agent does the rest</h2>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
            <input className="input flex-1" placeholder="https://boards.greenhouse.io/… · jobs.lever.co/… · company.wd5.myworkdayjobs.com/…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Job link" />
            <button className="btn-pink whitespace-nowrap" disabled={busy || !link.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Apply with agent</button>
          </form>
          <p className="mt-2 text-xs text-muted">Works with Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and most company sites. Vantage also starts watching that company for new roles.</p>
        </div>
      </section>

      <section className="mt-5 card flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-bold">Auto-apply {profile?.agent_enabled ? <span className="text-green-ink">is on</span> : <span className="text-muted">is off</span>}</p>
          <p className="text-sm text-muted">
            {profile?.agent_enabled
              ? `Your agent applies to your best new matches (up to ${profile?.daily_limit || 25} a day)${profile?.autonomy === "approve_important" ? ", and asks you first for target companies and top matches" : profile?.autonomy === "approve_all" ? ", and waits for your OK on each one" : ""}.`
              : "Your agent only applies when you press “Apply with agent” or paste a link. Turn this on to let it find and apply to new matches by itself."}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={Boolean(profile?.agent_enabled)}
          onClick={() => toggleAuto(!profile?.agent_enabled)}
          className={`relative h-8 w-14 shrink-0 rounded-full transition ${profile?.agent_enabled ? "bg-green" : ready ? "bg-[#cfd4de]" : "bg-[#e6e8ef]"}`}
          aria-label="Auto-apply"
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${profile?.agent_enabled ? "left-7" : "left-1"}`} />
        </button>
      </section>

      {setup && setupLeft > 0 && (
        <section className="mt-5 card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">Get your agent ready <span className="font-medium text-muted">· {steps.length - setupLeft} of {steps.length} done</span></h2>
            <div className="h-2 w-32 overflow-hidden rounded-full bg-line-2"><div className="h-full rounded-full bg-gradient-to-r from-brand to-pink" style={{ width: `${((steps.length - setupLeft) / steps.length) * 100}%` }} /></div>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.title}>
                <Link href={s.href} className={`flex h-full gap-3 rounded-xl border p-4 transition ${s.done ? "border-green/30 bg-green-tint/40" : "border-line hover:border-brand"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.done ? "bg-green text-white" : "bg-brand-tint text-brand"}`}>{s.done ? <Check size={18} /> : <s.icon size={18} />}</span>
                  <span><span className="block text-sm font-semibold">{s.title}</span><span className="block text-xs text-muted">{s.body}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: "Applied today", v: appliedToday, tone: "text-green-ink" },
          { k: "This week", v: week, tone: "text-ink" },
          { k: "In progress", v: inQueue, tone: "text-brand-ink" },
          { k: "Needs you", v: needs.length, tone: needs.length ? "text-orange-ink" : "text-ink" },
        ].map((s) => (
          <div key={s.k} className="card p-4">
            <p className="text-xs font-medium text-muted">{s.k}</p>
            <p className={`mt-1 text-2xl font-bold ${s.tone}`}>{s.v}</p>
          </div>
        ))}
      </section>

      {needs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><span className="live-dot" /> Needs you ({needs.length})</h2>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {needs.map((t) => (
                <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <NeedCard t={t} hasMailbox={Boolean(setup?.mailbox)} consent={Boolean(setup?.consent)} onDone={(m) => { setToast(m); load(); }} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-bold">Activity</h2>
          {(["all", "applied", "active", "problems"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`min-h-8 rounded-full border px-3 text-xs font-semibold capitalize ${filter === f ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2"}`}>{f === "problems" ? "Couldn't apply" : f}</button>
          ))}
        </div>
        {tasks === null && <div className="skeleton h-40" />}
        {tasks && shown.length === 0 && (
          <div className="card p-8 text-center">
            <p className="font-semibold">Nothing here yet</p>
            <p className="mt-1 text-sm text-muted">Paste a job link above, or open <Link href="/app/jobs" className="font-semibold text-brand-ink">Live jobs</Link> and press “Apply with agent”.</p>
          </div>
        )}
        <ul className="space-y-2">
          {shown.map((t) => <TaskRow key={t.id} t={t} onChange={load} />)}
        </ul>
      </section>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

async function patch(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/agent/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return { ok: Boolean(r?.ok), error: (d as { error?: string }).error };
}

/** The site's own wording for "I agree" when it offers options (so the answer matches exactly next time), else "Yes". */
const agreeValue = (n: AgentTask["needs"][number]) => n.options?.find((o) => /agree|accept|acknowledge|confirm|^yes\b|understand|consent/i.test(o)) || "Yes";

const isConsentNeed = (n: AgentTask["needs"][number]) =>
  n.kind === "consent" || /^(i certify|i acknowledge|i agree|i understand|i consent|i confirm)|applicant privacy|privacy (policy|notice) acknowledg|true and correct to the best/i.test(n.label.trim()) || (n.type === "checkbox" && /certify|acknowledge|agree|consent|privacy|terms|true and correct/i.test(n.label));

/** Tidy a question for display: no doubled label text, no options that clearly belong to another field. */
function tidy(n: AgentTask["needs"][number]): AgentTask["needs"][number] {
  const t = n.label.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ").trim();
  // "Question? Question?" or a repeat cut off mid-way: keep the first copy.
  const head = t.slice(0, Math.min(40, Math.floor(t.length / 2)));
  const again = head.length >= 3 ? t.toLowerCase().indexOf(head.toLowerCase(), head.length) : -1;
  const label = (again > 0 ? t.slice(0, again) : t).trim();
  const opts = n.options || [];
  const foreign = opts.length > 20 && opts.filter((o) => /\+\d{1,4}$/.test(o.trim())).length > opts.length / 2; // a phone country-code list
  return { ...n, label, options: foreign ? undefined : n.options };
}

function NeedCard({ t, hasMailbox, consent, onDone }: { t: AgentTask; hasMailbox: boolean; consent: boolean; onDone: (msg: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [always, setAlways] = useState(true);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const head = (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">{t.job.company}</p>
        <p className="font-semibold">{t.job.title}</p>
      </div>
      <Badge tone={STATUS_META[t.status]?.tone || "gray"}>{STATUS_META[t.status]?.label || t.status}</Badge>
    </div>
  );

  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    const r = await patch(t.id, body);
    setBusy(false);
    onDone(r.ok ? msg : r.error || "Something went wrong.");
  }

  async function openLive() {
    const r = await fetch("/api/agent/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: t.id }) });
    const d = await r.json();
    if (!r.ok) return onDone(d.error || "Live view isn't available.");
    setLiveUrl(`${d.url}?t=${encodeURIComponent(d.token)}&embed=1`);
  }

  if (t.status === "needs_user" && t.needs?.length) {
    const needs = t.needs.map(tidy);
    const consents = needs.filter(isConsentNeed);
    const questions = needs.filter((n) => !isConsentNeed(n));
    const ready = questions.every((n) => vals[n.id]?.trim()) && consents.every((n) => Boolean(vals[n.id]));
    return (
      <div className="card border-orange/30 p-5">
        {head}
        <p className="mt-2 text-sm text-muted">Answer once — your agent saves it and reuses it on every future application.</p>
        <form className="mt-4 space-y-4" onSubmit={(e) => {
          e.preventDefault();
          act({ action: "answers", answers: vals, alwaysConsent: consents.length > 0 && always && !consent }, "Saved. Your agent is applying now.");
        }}>
          {consents.length > 0 && (
            <div className="rounded-xl border border-line bg-canvas p-4">
              <p className="text-sm font-semibold">{t.job.company} asks you to confirm</p>
              <div className="mt-3 space-y-3">
                {consents.map((n) => (
                  <label key={n.id} className="flex cursor-pointer items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" checked={Boolean(vals[n.id])}
                      onChange={(e) => setVals({ ...vals, [n.id]: e.target.checked ? agreeValue(n) : "" })} />
                    <span>{n.label}</span>
                  </label>
                ))}
              </div>
              {!consent && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-line pt-3 text-sm text-muted">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={always} onChange={(e) => setAlways(e.target.checked)} />
                  <span>Confirm these standard statements (accuracy, privacy notice, terms) for me on future applications. You can turn this off in Settings.</span>
                </label>
              )}
            </div>
          )}
          {questions.map((n) => (
            <label key={n.id} className="block text-sm font-semibold">
              {n.label}
              {n.tried && <span className="mt-0.5 block text-xs font-normal text-muted">The site didn&apos;t accept “{n.tried}”. Pick the option that fits.</span>}
              {n.type === "checkbox" && !n.options?.length ? (
                <span className="mt-2 flex gap-2">
                  {["Yes", "No"].map((o) => (
                    <button type="button" key={o} onClick={() => setVals({ ...vals, [n.id]: o })} aria-pressed={vals[n.id] === o}
                      className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${vals[n.id] === o ? "border-brand bg-brand text-white" : "border-line hover:bg-canvas"}`}>{o}</button>
                  ))}
                </span>
              ) : n.options?.length ? (
                n.options.length <= 4 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.options.map((o) => (
                      <button type="button" key={o} onClick={() => setVals({ ...vals, [n.id]: o })} aria-pressed={vals[n.id] === o}
                        className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${vals[n.id] === o ? "border-brand bg-brand text-white" : "border-line hover:bg-canvas"}`}>{o}</button>
                    ))}
                  </div>
                ) : (
                  <select className="input mt-1.5" value={vals[n.id] || ""} onChange={(e) => setVals({ ...vals, [n.id]: e.target.value })}>
                    <option value="">Choose…</option>
                    {n.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                )
              ) : n.type === "textarea" ? (
                <textarea className="input mt-1.5 py-2.5 font-normal" rows={3} value={vals[n.id] || ""} onChange={(e) => setVals({ ...vals, [n.id]: e.target.value })} />
              ) : (
                <input className="input mt-1.5 font-normal" type={n.type === "date" ? "date" : n.type === "number" ? "number" : "text"} value={vals[n.id] || ""} onChange={(e) => setVals({ ...vals, [n.id]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !ready}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save answers and apply</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => act({ action: "retry" }, "Your agent is re-checking the form with everything it knows now.")}>Re-check the form</button>
            <button type="button" className="btn-ghost" onClick={() => act({ action: "cancel" }, "Skipped this job.")}>Skip this job</button>
          </div>
        </form>
      </div>
    );
  }
  if (t.status === "needs_human") {
    return (
      <div className="card border-orange/30 p-5">
        {head}
        <p className="mt-2 text-sm">{t.job.company}&apos;s site wants a quick “I&apos;m human” check. Everything else is filled in. Open the check, complete it, and your agent carries on by itself — this window closes when it&apos;s done.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-pink" onClick={openLive}><MonitorPlay size={16} /> Do the human check</button>
          <a className="btn-ghost" href={t.apply_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Open the job page instead</a>
        </div>
        {liveUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Human check for ${t.job.company}`}>
            <div className="flex h-full max-h-[920px] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <MonitorPlay size={18} className="text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.job.company} · human check</p>
                  <p className="text-xs text-muted">Only tick the box or pick the images. Your agent sees when it&apos;s done and continues.</p>
                </div>
                <button className="btn-secondary" disabled={busy} onClick={async () => { await act({ action: "human_done" }, "Thanks — your agent is continuing."); setLiveUrl(null); }}>I&apos;m done</button>
                <button className="rounded-lg p-2 hover:bg-canvas" aria-label="Close" onClick={() => setLiveUrl(null)}><X size={18} /></button>
              </div>
              <iframe src={liveUrl} title="Your agent's browser" className="w-full flex-1 border-0 bg-canvas" />
            </div>
          </div>
        )}
      </div>
    );
  }
  if (t.status === "waiting_code" && !hasMailbox) {
    return (
      <div className="card border-orange/30 p-5">
        {head}
        <p className="mt-2 text-sm">Enter the verification code {t.job.company} just emailed you. Tip: connect a job email in Settings and your agent will read these codes itself.</p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: "code", code }, "Code sent to your agent."); }}>
          <input className="input max-w-[200px] tracking-[0.3em]" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Verification code" placeholder="123456" />
          <button className="btn-primary" disabled={busy || code.trim().length < 4}>Send code</button>
        </form>
      </div>
    );
  }
  if (t.status === "awaiting_approval") {
    return (
      <div className="card border-pink/30 p-5">
        {head}
        <p className="mt-2 text-sm text-muted">Ready to apply with a tailored resume{t.cover_letter ? " and cover letter" : ""}.{t.job.match ? ` ${t.job.match}% match.` : ""}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => act({ action: "approve" }, "Approved — applying now.")}><Check size={16} /> Approve and apply</button>
          {t.resume_id && <a className="btn-secondary" href={`/api/resume/${t.resume_id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><FileText size={16} /> Resume</a>}
          {t.resume_id && t.cover_letter && <a className="btn-secondary" href={`/api/resume/${t.resume_id}/pdf?kind=cover&inline=1`} target="_blank" rel="noopener noreferrer">Cover letter</a>}
          <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Skipped.")}><X size={16} /> Skip</button>
        </div>
      </div>
    );
  }
  // manual: the site needs the user to finish
  return (
    <div className="card p-5">
      {head}
      <p className="mt-2 text-sm">{t.error || t.step || "This application needs you to finish it on the company's site."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn-primary" href={t.job.url || t.apply_url} target="_blank" rel="noopener noreferrer">Open the job <ExternalLink size={15} /></a>
        <button className="btn-secondary" disabled={busy} onClick={() => act({ action: "retry" }, "Your agent will try again.")}><RotateCcw size={16} /> Try again</button>
        <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Dismissed.")}>Dismiss</button>
      </div>
    </div>
  );
}

function TaskRow({ t, onChange }: { t: AgentTask; onChange: () => void }) {
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
          <span className="block truncate text-xs text-muted">{t.job.company}{t.job.location ? ` · ${t.job.location}` : ""} · {t.step || meta.label}</span>
        </span>
        <span className="hidden text-xs text-muted sm:block">{timeAgo(t.updated_at)}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <ChevronDown size={16} className={`text-subtle transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line bg-canvas/40 px-4 py-4 md:grid-cols-[1fr_280px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">What your agent did</p>
            <ol className="mt-2 space-y-1.5 border-l border-line pl-4 text-sm">
              {(t.log || []).slice(-14).map((l, i) => (
                <li key={i} className="relative"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" />{l.text} <span className="text-xs text-muted">· {timeAgo(l.at)}</span></li>
              ))}
              {!t.log?.length && <li className="text-muted">Waiting to start.</li>}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              {t.resume_id && <a className="btn-secondary min-h-9 text-xs" href={`/api/resume/${t.resume_id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><FileText size={14} /> Resume sent</a>}
              {t.resume_id && t.cover_letter && <a className="btn-secondary min-h-9 text-xs" href={`/api/resume/${t.resume_id}/pdf?kind=cover&inline=1`} target="_blank" rel="noopener noreferrer">Cover letter</a>}
              <a className="btn-ghost min-h-9 text-xs" href={t.job.url || t.apply_url} target="_blank" rel="noopener noreferrer">Job posting <ExternalLink size={13} /></a>
              {["failed", "cancelled"].includes(t.status) && <button className="btn-ghost min-h-9 text-xs" onClick={async () => { await patch(t.id, { action: "retry" }); onChange(); }}><RotateCcw size={13} /> Retry</button>}
              {["queued", "awaiting_approval"].includes(t.status) && <button className="btn-ghost min-h-9 text-xs" onClick={async () => { await patch(t.id, { action: "cancel" }); onChange(); }}>Cancel</button>}
              {t.application_id && <Link className="btn-ghost min-h-9 text-xs" href="/app/applications">Track it <ArrowRight size={13} /></Link>}
            </div>
            {t.resume_style && <p className="mt-3 text-xs text-muted">Resume style: {t.resume_style} · Letter tone: {t.letter_tone}</p>}
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><ShieldCheck size={13} /> Proof</p>
            {proof ? (
              <a href={`data:image/jpeg;base64,${proof}`} target="_blank" rel="noopener noreferrer"><img src={`data:image/jpeg;base64,${proof}`} alt={`Screenshot of the ${t.job.company} application`} className="mt-2 w-full rounded-lg border border-line" /></a>
            ) : (
              <p className="mt-2 text-xs text-muted">A screenshot of the confirmation page appears here after submitting.</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
