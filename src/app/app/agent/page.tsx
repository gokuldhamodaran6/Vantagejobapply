"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, FileText, Link2, Loader2, Mail, RefreshCw, RotateCcw, ShieldCheck, Sparkles, UserRound, WifiOff, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Badge, Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials, timeAgo, tintFor } from "@/lib/format";
import { dailyLimit, effectivePlan } from "@/lib/access";
import { cleanOptions, isCodeQuestion, isVoluntaryId, isYesNoQuestion } from "@/lib/agent/options";
import { limitDayStart } from "@/lib/agent/plan";
import { cleanSchedule, inQuietHours, todaysRuns, type AutoSchedule } from "@/lib/agent/schedule";
import { NEEDS_YOU, STATUS_META, statusLine, type AgentTask } from "@/lib/agent/status";
import { Activity } from "./activity";
import { JobFunnel, usePipeline } from "./pipeline";
import { agoShort, countsToday, patch, useAgentData, useTicker, type RetryRow } from "./shared";

type LinkPreview = {
  job: { id: string; title: string; company: string; location: string | null; remote: boolean; posted_at: string | null; url: string; pay: string | null };
  match: { score: number; eligible: boolean; blockers: string[]; warnings: string[]; reasons: string[]; role: { id: string; title: string } | null };
  site: { system: string; host: string; account: boolean };
  duplicate: string | null;
  closed: boolean;
};
type Setup = { mailbox: { address: string; status: string } | null; profileDone: boolean; consent: boolean; hasResume: boolean; schedule: AutoSchedule };

const STAGES = ["Open the job", "Account & email", "Fill the form", "Submit"];
function stageOf(t: AgentTask) {
  if (/^(opening|moved to the front|retrying)/i.test(t.step || "")) return 0;
  const s = `${t.step || ""} ${(t.log || []).slice(-1)[0]?.text || ""}`.toLowerCase();
  if (/submit/.test(s)) return 3;
  if (/next step|filling|question|answer/.test(s)) return 2;
  if (/account|sign|verif|code|email/.test(s)) return 1;
  return t.status === "running" && (t.log || []).length > 2 ? 2 : 0;
}

export default function AgentPage() {
  const { userId, profile, refresh, roles } = useMe();
  // Live: re-syncs by itself every few seconds while the tab is visible; Refresh also recounts matches.
  const { working, index, stages, totalApplied, version, syncedAt, offline, refresh: resync } = useAgentData(userId);
  const [retry, setRetry] = useState<{ safe: RetryRow[]; held: RetryRow[] } | null>(null);
  const [pipeKey, setPipeKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const loadRetry = useCallback(async () => {
    const d = await fetch("/api/agent/tasks/requeue").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d && Array.isArray(d.safe)) setRetry({ safe: d.safe, held: d.held || [] });
  }, []);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [agentUp, setAgentUp] = useState<boolean | null>(null);
  const now = useTicker(5000);
  // Jobs the agent can't finish open on the company's own site, where the Vantage extension fills them in your Chrome.
  const openOnSite = useCallback((t: AgentTask) => {
    window.open(`${(t.apply_url || t.job.url).split("#")[0]}#vantage-apply`, "_blank", "noopener");
    if (!t.submit_clicked_at && !["submitted", "extension"].includes(t.status)) void patch(t.id, { action: "to_browser" }).then(() => resync());
  }, [resync]);

  const loadSetup = useCallback(async () => {
    const s = supabaseBrowser();
    const [m, a, r, p] = await Promise.all([
      s.from("mail_accounts").select("address,status").maybeSingle(),
      s.from("applicant_profiles").select("*").maybeSingle(),
      s.from("resumes").select("id", { count: "exact", head: true }),
      s.from("profiles").select("auto_schedule").maybeSingle(),
    ]);
    const ap = a.data as Record<string, unknown> | null;
    setSetup({
      mailbox: (m.data as Setup["mailbox"]) || null,
      profileDone: Boolean(ap && ap.phone && ap.city && ap.country),
      consent: Boolean(ap?.agent_consent),
      hasResume: (r.count || 0) > 0,
      schedule: cleanSchedule((p.data as { auto_schedule: AutoSchedule } | null)?.auto_schedule || null),
    });
  }, []);

  // What "Retry" would do: re-checked whenever the task list changes.
  useEffect(() => {
    if (userId) void loadRetry();
  }, [userId, version, loadRetry]);

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([resync(), loadSetup(), loadRetry(), refresh()]);
    setPipeKey((k) => k + 1);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!userId) return;
    void loadSetup();
    const onFocus = () => void loadSetup();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [userId, loadSetup]);

  const live = useMemo(() => working || [], [working]);
  const ix = useMemo(() => index || [], [index]);

  // Jobs waiting and nothing running: check whether the agent's browser is up, and start it if it isn't.
  const waiting = live.filter((t) => t.status === "queued").length;
  const busyNow = live.some((t) => ["running", "waiting_code", "needs_human"].includes(t.status));
  useEffect(() => {
    if (!waiting || busyNow) return;
    let stop = false;
    const check = async () => {
      const d = await fetch("/api/agent/wake").then((r) => r.json()).catch(() => ({ up: false }));
      if (stop) return;
      setAgentUp(Boolean(d.up));
      if (!d.up || !d.running) fetch("/api/agent/wake", { method: "POST" }).catch(() => {});
    };
    void check();
    const i = setInterval(check, 15_000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [waiting, busyNow]);

  // Paste a link: Vantage reads it first and shows what it is; then you choose what happens.
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  async function readLink() {
    if (!/^https?:\/\//i.test(link.trim())) return setToast("Paste the full job link, starting with https://");
    setBusy(true);
    setPreview(null);
    const r = await fetch("/api/agent/tasks/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: link.trim() }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setBusy(false);
    if (!r?.ok) return setToast(d.error || "Couldn't read that job link.");
    setPreview(d as LinkPreview);
  }
  async function applyLink(how: "now" | "next" | "later") {
    setBusy(true);
    const r = await fetch("/api/agent/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: link.trim(), later: how === "later", roleId: preview?.match.role?.id || null }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    if (!r?.ok) { setBusy(false); return setToast(d.error || "Couldn't start that application."); }
    setLink("");
    setPreview(null);
    setBusy(false);
    setToast(how === "later" ? `${d.job.company} saved — it waits in Your agent for your OK.` : `${d.job.title} at ${d.job.company} is in Up next — tailored resume and cover letter, then your agent applies.`);
    void resync();
  }

  async function retrySafe() {
    if (!retry?.safe.length) return;
    setBusy(true);
    const r = await fetch("/api/agent/tasks/requeue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: retry.safe.map((x) => x.id) }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(false);
    setToast(r?.ok ? (d.queued ? `${d.queued} job${d.queued > 1 ? "s" : ""} back in line — your agent is starting.${d.capped ? " The rest wait for tomorrow's limit." : ""}` : "Nothing could be retried safely.") : d.error || "Couldn't retry.");
    void resync();
    void loadRetry();
  }

  const hasMailbox = Boolean(setup?.mailbox);
  const needs = live.filter((t) => NEEDS_YOU.includes(t.status) || (t.status === "waiting_code" && codeNeedsYou(t, hasMailbox, now)));
  // Jobs waiting only on questions: answered together, once (site terms and live runs keep their own cards).
  const askTasks = needs.filter((t) => t.status === "needs_user" && (t.needs || []).length > 0 && !(t.needs || []).some((n) => n.live || n.kind === "consent"));
  const today = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const appliedToday = ix.filter((t) => t.status === "submitted" && Date.parse(t.finished_at || t.updated_at) >= today).length;
  const week = ix.filter((t) => t.status === "submitted" && Date.parse(t.finished_at || t.updated_at) >= now - 7 * 864e5).length;
  const liveNow = live.filter((t) => ["running", "waiting_code", "needs_human"].includes(t.status)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  // Same order the agent takes them in: "Apply now" jobs first, then by priority, then oldest first.
  const upNext = live.filter((t) => t.status === "queued").sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || Date.parse(a.created_at) - Date.parse(b.created_at));
  // How long one application takes, from this user's own finished runs (3 min until there's data).
  const perJob = (() => {
    const d = ix.filter((t) => t.status === "submitted" && t.started_at && t.finished_at).map((t) => Date.parse(t.finished_at!) - Date.parse(t.started_at!)).filter((x) => x > 30_000 && x < 20 * 60_000);
    return d.length ? Math.max(1.5, Math.min(8, d.reduce((a, b) => a + b, 0) / d.length / 60_000)) : 3;
  })();
  const etaMin = (i: number) => Math.round((liveNow.length ? perJob * 0.5 : agentUp ? 0.5 : 1) + i * (perJob + 0.15));
  const stuckFor = upNext.length && !liveNow.length ? now - Math.min(...upNext.map((t) => Date.parse(t.updated_at))) : 0;
  const queuePos = new Map(upNext.map((t, i) => [t.id, i + 1]));
  const limit = dailyLimit(profile as { daily_limit?: number | null; high_volume_ok?: boolean | null } | null, effectivePlan(profile?.plan, profile?.role));
  const usedToday = ix.filter((t) => countsToday(t, limitDayStart(now))).length;
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

  const pipeRolesKey = roles.map((r) => `${r.id}:${r.priority}:${r.active}:${r.title}:${r.levels.join(",")}:${r.keywords.length}`).join("|");
  const pipe = usePipeline(pipeKey, pipeRolesKey);
  const manualTasks = needs.filter((t) => t.status === "manual");
  const otherNeeds = needs.filter((t) => t.status !== "manual" && !askTasks.includes(t));
  const now0 = liveNow[0];

  return (
    <>
      <PageHeader
        title="Your agent"
        subtitle="Applies for you on companies' own careers sites, with a resume and cover letter written for each job."
        actions={
          <>
            <span className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs text-muted" role="status" aria-live="polite">
              {offline ? (
                <><WifiOff size={13} className="text-orange" aria-hidden /> Reconnecting…</>
              ) : syncedAt ? (
                <><span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green" /></span> Live · {agoShort(syncedAt, now)}</>
              ) : (
                <><Loader2 size={13} className="animate-spin" aria-hidden /> Connecting…</>
              )}
            </span>
            <button className="btn-secondary" onClick={() => void refreshAll()} disabled={refreshing} aria-label="Refresh everything on this page">
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden /> Refresh
            </button>
          </>
        }
      />

      {profile && !(profile as { adult_confirmed_at?: string | null }).adult_confirmed_at && (
        <section className="mb-5 card flex flex-wrap items-center gap-3 border-orange/30 p-4">
          <ShieldCheck size={18} className="text-orange" aria-hidden />
          <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">One quick check before your agent applies:</span> Vantage is for adults. Please confirm you&apos;re 18 or older.</p>
          <button className="btn-primary min-h-9" onClick={async () => {
            const { error } = await supabaseBrowser().from("profiles").update({ adult_confirmed_at: new Date().toISOString() }).eq("id", userId!);
            if (error) return setToast(`Couldn't save that: ${error.message}`);
            await supabaseBrowser().from("agent_tasks").update({ status: "queued", error: null, needs: [], locked_at: null, step: "Back in line — you confirmed you're 18 or older" })
              .eq("status", "manual").ilike("error", "%18 or older%").is("submit_clicked_at", null);
            await refresh();
            void resync();
            setToast("Thanks — confirmed. Jobs that were waiting on this are back in line.");
          }}>I&apos;m 18 or older</button>
        </section>
      )}

      {setup && setupLeft > 0 && (
        <section className="mb-5 card p-5">
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

      {/* 1 · Today, at a glance */}
      <section className="card overflow-hidden" aria-labelledby="today-h" aria-live="polite">
        <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Today</p>
            {working === null ? (
              <div className="mt-2 space-y-2" aria-busy="true"><div className="skeleton h-7 w-2/3" /><div className="skeleton h-4 w-1/2" /></div>
            ) : (
              <>
                <h2 id="today-h" className="mt-1 text-2xl font-bold tracking-tight">
                  {now0 ? <>Applying to {now0.job.title} <span className="text-muted">at {now0.job.company}</span></> : appliedToday ? `${appliedToday} application${appliedToday > 1 ? "s" : ""} sent today` : profile?.agent_enabled ? "Your agent is looking for your best matches" : "Auto-apply is off"}
                </h2>
                <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span><b className="text-ink tabular-nums">{appliedToday}</b> sent today</span>
                  <span><b className="text-ink tabular-nums">{upNext.length}</b> in line</span>
                  <span className={needs.length ? "text-orange-ink" : ""}><b className="tabular-nums">{needs.length}</b> need you</span>
                  <span><b className="text-ink tabular-nums">{week}</b> this week · <b className="text-ink tabular-nums">{totalApplied ?? "—"}</b> in total</span>
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold">Auto-apply {profile?.agent_enabled ? <span className="text-green-ink">on</span> : <span className="text-muted">off</span>}</p>
              <Link href="/app/settings#agent-mode" className="text-xs text-muted hover:text-brand-ink">{profile?.autonomy === "fully_automatic" ? "Fully automatic" : profile?.autonomy === "approve_all" ? "You approve each one" : "You approve important ones"} · up to {limit}/day</Link>
            </div>
            <button role="switch" aria-checked={Boolean(profile?.agent_enabled)} onClick={() => toggleAuto(!profile?.agent_enabled)} aria-label="Auto-apply"
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${profile?.agent_enabled ? "bg-green" : ready ? "bg-[#cfd4de]" : "bg-[#e6e8ef]"}`}>
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${profile?.agent_enabled ? "left-7" : "left-1"}`} />
            </button>
          </div>
        </div>

        {/* Daily limit */}
        <div className="px-5 pb-4 sm:px-6">
          <div className="flex items-center justify-between text-xs text-muted"><span>{usedToday} of {limit} applications used today</span>{profile?.agent_enabled && setup && (() => {
            const runs = todaysRuns(setup.schedule, now);
            const nextRun = runs.find((r) => r.state === "next");
            return <Link href="/app/settings#schedule" className="hover:text-brand-ink">{nextRun ? `Next run ${nextRun.label}` : inQuietHours(setup.schedule, now) ? "Quiet hours — resumes in the morning" : "Checks for new jobs every 10 min"}</Link>;
          })()}</div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2"><div className="h-full rounded-full bg-gradient-to-r from-brand to-pink transition-all" style={{ width: `${Math.min(100, (usedToday / Math.max(1, limit)) * 100)}%` }} /></div>
        </div>

        {/* Applying now */}
        {now0 && (() => {
          const st = stageOf(now0);
          return (
            <div className="border-t border-line bg-canvas/40 px-5 py-4 sm:px-6">
              <div className="grid grid-cols-4 gap-2">
                {STAGES.map((label, i) => (
                  <div key={label}>
                    <div className={`h-1.5 rounded-full ${i < st ? "bg-brand" : i === st ? "animate-pulse bg-brand/60" : "bg-line-2"}`} />
                    <p className={`mt-1.5 text-[11px] font-semibold ${i <= st ? "text-ink" : "text-subtle"}`}>{label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm"><span className="font-semibold">Now:</span> {statusLine(now0)} <span className="text-xs text-muted">· {timeAgo(now0.updated_at)}</span></p>
              {now0.status === "waiting_code" && siteCode(now0) && !codeNeedsYou(now0, hasMailbox, now) && (
                <p className="mt-2 flex items-start gap-2 text-[13px] text-ink-2"><Mail size={15} className="mt-0.5 shrink-0 text-brand" /> {siteCode(now0)!.system} emailed a security code to {siteCode(now0)!.sentTo}. Your agent reads it from your inbox — nothing to do.</p>
              )}
            </div>
          );
        })()}

        {/* In line */}
        {upNext.length > 0 && (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <p className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
              <span>In line · one at a time</span>
              {!now0 && <span className="normal-case tracking-normal">{agentUp ? "Starting the next one" : "Waking up your agent (about a minute)"}{stuckFor > 4 * 60_000 && <button className="ml-2 font-semibold text-brand-ink" onClick={async () => { setToast("Starting your agent…"); await fetch("/api/agent/wake", { method: "POST" }).catch(() => null); void resync(); }}>Start now</button>}</span>}
            </p>
            <ol className="space-y-1.5">
              {upNext.slice(0, 4).map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs font-bold text-subtle">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{t.job.title}</span> <span className="text-muted">· {t.job.company}</span></span>
                  <span className="shrink-0 text-xs text-muted">{i === 0 && !now0 ? "next" : `~${etaMin(i)} min`}</span>
                  {i > 0 && <button className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-ink hover:bg-brand-tint" onClick={async () => { const r = await patch(t.id, { action: "apply_now" }); setToast(r.ok ? `${t.job.company} moved to the front.` : r.error || "Couldn't move it."); void resync(); }}>Do next</button>}
                </li>
              ))}
              {upNext.length > 4 && <li className="pl-7 text-xs text-muted">+{upNext.length - 4} more · about {Math.round(upNext.length * perJob)} min for all</li>}
            </ol>
          </div>
        )}
      </section>

      {/* 2 · What needs you */}
      {needs.length > 0 && (
        <section className="mt-8" aria-labelledby="needs-you">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="needs-you" className="scroll-mt-20 text-lg font-bold">Needs you</h2>
            <p className="text-sm text-muted">
              {[askTasks.length ? `${askTasks.length} wait${askTasks.length > 1 ? "" : "s"} on your answers` : "", otherNeeds.length ? `${otherNeeds.length} to check` : "", manualTasks.length ? `${manualTasks.length} to finish on the company's site` : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="space-y-4">
            {askTasks.length > 0 && <AskOnce tasks={askTasks} onDone={(m) => { setToast(m); void resync(); }} />}
            <AnimatePresence initial={false}>
              {otherNeeds.map((t) => (
                <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <NeedCard t={t} hasMailbox={hasMailbox} consent={Boolean(setup?.consent)} onOpen={openOnSite} onDone={(m) => { setToast(m); void resync(); }} />
                </motion.div>
              ))}
            </AnimatePresence>
            {manualTasks.length > 0 && <FinishOnSite tasks={manualTasks} onOpen={openOnSite} onDone={(m) => { setToast(m); void resync(); }} />}
          </div>
        </section>
      )}

      {/* 3 · What the agent takes next, and why */}
      <div className="mt-8">
        <JobFunnel
          data={pipe.data}
          loading={pipe.loading}
          failed={pipe.failed}
          onReload={(fresh) => void pipe.load(fresh)}
          roles={roles}
          index={index}
          enabled={Boolean(profile?.agent_enabled)}
          limit={limit}
          usedToday={usedToday}
          onRolesChanged={refresh}
          onToast={setToast}
        />
      </div>

      {/* 4 · Apply to a specific job */}
      <section className="mt-8 card p-5 sm:p-6" aria-labelledby="link-h">
        <h2 id="link-h" className="flex items-center gap-2 font-bold"><Link2 size={17} className="text-brand" /> Apply to a specific job</h2>
        <p className="mt-0.5 text-sm text-muted">Paste a job link from any company&apos;s careers site — Greenhouse, Lever, Ashby, Workday and most others. Vantage reads it first, then you choose.</p>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void readLink(); }}>
          <input className="input flex-1" placeholder="https://…" value={link} onChange={(e) => { setLink(e.target.value); setPreview(null); }} aria-label="Job link" />
          <button className="btn-primary whitespace-nowrap" disabled={busy || !link.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Read job</button>
        </form>
        {preview && (
          <div className="mt-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={tintFor(preview.job.company)}>{initials(preview.job.company)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold">{preview.job.title}</p>
                <p className="text-sm text-muted">{[preview.job.company, preview.job.location, preview.job.remote ? "Remote" : null, preview.job.pay, preview.job.posted_at ? `posted ${timeAgo(preview.job.posted_at)}` : null].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="text-right"><p className={`text-2xl font-bold ${preview.match.eligible ? "text-green-ink" : "text-red-ink"}`}>{preview.match.eligible ? `${preview.match.score}%` : "—"}</p><p className="text-xs text-muted">{preview.match.eligible ? "match" : "can't hire you"}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="gray">{preview.site.system}</Badge>
              <Badge tone={preview.site.account ? "orange" : "green"}>{preview.site.account ? "Needs an account — your agent creates it" : "No account needed"}</Badge>
              <Badge tone={preview.duplicate ? "red" : "green"}>{preview.duplicate ? "Applied before" : "Not applied before"}</Badge>
              {preview.match.role && <Badge tone="blue">{preview.match.role.title}</Badge>}
              {preview.match.blockers.map((b) => <Badge key={b} tone="red">{b}</Badge>)}
              {preview.match.warnings.slice(0, 2).map((w) => <Badge key={w} tone="orange">{w}</Badge>)}
            </div>
            {preview.match.reasons.length > 0 && <p className="mt-3 text-sm text-ink-2"><b>Why it fits:</b> {preview.match.reasons.join(" · ")}</p>}
            {preview.duplicate || preview.closed ? (
              <p className="mt-3 text-sm font-semibold text-red-ink">{preview.closed ? `${preview.job.company} has closed this job.` : `${preview.duplicate} — it won't be sent again.`}</p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => void applyLink("now")}><Sparkles size={16} /> Apply now</button>
                <button className="btn-secondary" disabled={busy} onClick={() => void applyLink("next")}>Add to the line</button>
                <button className="btn-ghost" disabled={busy} onClick={() => void applyLink("later")}>Save for later</button>
                <a className="btn-ghost" href={preview.job.url} target="_blank" rel="noopener noreferrer">View posting <ExternalLink size={14} /></a>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 5 · Everything your agent did */}
      <Activity
        index={index}
        version={version}
        roles={roles}
        queuePos={queuePos}
        stages={stages}
        retry={retry}
        busy={busy}
        onRetry={retrySafe}
        onChange={() => void resync()}
        onToast={setToast}
        onOpen={openOnSite}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
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
  const opts2 = foreign ? undefined : cleanOptions(label, n.options);
  // A yes/no question whose list the site didn't show yet: Yes / No buttons, not a text box.
  return { ...n, label, options: opts2?.length ? opts2 : n.type !== "textarea" && isYesNoQuestion(label) ? ["Yes", "No"] : opts2 };
}

type SiteCode = { kind: "site_code"; system: string; company: string; sentTo: string; length: number | null; auto: boolean; purpose?: "application" | "account"; startedAt: string; expiresAt: string; error?: string };
const siteCode = (t: AgentTask) => ((t.needs as unknown as SiteCode[] | null)?.[0]?.kind === "site_code" ? (t.needs as unknown as SiteCode[])[0] : null);
/** With a connected inbox the agent reads codes itself; only ask the user when that hasn't worked within ~45s or a code was rejected. */
function codeNeedsYou(t: AgentTask, hasMailbox: boolean, now: number) {
  const sc = siteCode(t);
  if (!hasMailbox) return true;
  if (!sc) return false;
  return Boolean(sc.error) || now - Date.parse(sc.startedAt) > 45_000;
}

/** One clean code box (not one question per character): paste or type, and the agent submits immediately. */
function CodeCard({ t, hasMailbox, head, onDone }: { t: AgentTask; hasMailbox: boolean; head: ReactNode; onDone: (msg: string) => void }) {
  const sc = siteCode(t);
  const len = sc?.length || 8;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const left = sc ? Math.max(0, Date.parse(sc.expiresAt) - now) : 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  const clean = (v: string) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, sc ? len : 10); // codes can be case-sensitive (e.g. 4djckW6H)
  const ready = sc ? code.length === len : code.length >= 4;
  async function send() {
    setBusy(true);
    const r = await patch(t.id, { action: "code", code });
    setBusy(false);
    onDone(r.ok ? "Code sent — your agent is entering it and submitting now." : r.error || "Couldn't send the code.");
  }
  const sentTo = sc?.sentTo || "your job email";
  return (
    <div className="card border-brand/30 p-5">
      {head}
      <div className="mt-3 rounded-xl bg-brand-tint/60 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-brand" /> {sc ? (sc.purpose === "account" ? `Verifying your new ${sc.company} account` : `One last step: ${sc.company}'s security code`) : "Verify your email"}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {sc
            ? sc.purpose === "account"
              ? <>Your agent is creating your {sc.company} careers account with <b>{sentTo}</b>. {sc.system} emailed a {len}-character code to verify it. {hasMailbox ? "Your agent reads it from your inbox and enters it itself — or paste it here." : "Paste it here and your agent carries on with the application."}</>
              : <>Your application is filled in. {sc.company} receives applications through <b>{sc.system}</b>, and {sc.system} just emailed an {len}-character code to <b>{sentTo}</b> to confirm a real person is applying. {hasMailbox ? "Your agent checks your inbox every few seconds and enters it itself — or paste it here." : "Paste it here and your agent submits right away."}</>
            : <>{t.job.company} emailed a verification code to <b>{sentTo}</b>. Enter it and your agent carries on. Tip: connect your job email in Settings and your agent reads these codes itself.</>}
        </p>
        {sc?.error && <p className="mt-2 text-[13px] font-semibold text-red-ink">{sc.error}. Use the newest email from {sc.system}.</p>}
      </div>
      <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (ready) void send(); }}>
        <label className="text-xs font-semibold text-muted" htmlFor={`code-${t.id}`}>Security code</label>
        <div className="relative mt-1.5 max-w-md">
          <input
            id={`code-${t.id}`}
            autoFocus
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(clean(e.target.value))}
            onPaste={(e) => { e.preventDefault(); setCode(clean(e.clipboardData.getData("text"))); }}
            className="absolute inset-0 h-full w-full cursor-text opacity-0"
            aria-label={`${len}-character security code`}
          />
          <div className="pointer-events-none grid gap-1.5" style={{ gridTemplateColumns: `repeat(${sc ? len : 6}, minmax(0, 1fr))` }} aria-hidden>
            {Array.from({ length: sc ? len : Math.max(6, code.length) }).map((_, i) => (
              <span key={i} className={`flex h-12 items-center justify-center rounded-lg border bg-white font-mono text-lg font-bold ${i === code.length ? "border-brand ring-2 ring-brand/20" : code[i] ? "border-ink-2/30" : "border-line"}`}>{code[i] || ""}</span>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy || !ready}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {sc?.purpose === "account" ? "Verify and continue" : "Submit application"}</button>
          <button type="button" className="btn-ghost" onClick={async () => { try { setCode(clean(await navigator.clipboard.readText())); } catch { /* clipboard blocked */ } }}>Paste</button>
          <a className="btn-ghost" href={`https://mail.google.com/mail/u/${encodeURIComponent(sentTo)}/#search/${encodeURIComponent(sc ? `from:${sc.system.toLowerCase()} ${sc.company}` : "code")}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open Gmail</a>
          {sc && <span className="ml-auto text-xs text-muted">{left > 0 ? <>Page held open for you · {mmss}</> : "Time's up — retry to get a new code"}</span>}
        </div>
      </form>
    </div>
  );
}

/** First application on a kind of careers site: the form is filled and waiting — the person checks it before anything is sent. */
function ReviewCard({ t, head, busy, act }: { t: AgentTask; head: ReactNode; busy: boolean; act: (body: Record<string, unknown>, msg: string) => void }) {
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser().from("agent_proofs").select("image").eq("task_id", t.id).maybeSingle().then(({ data }) => setShot((data as { image: string } | null)?.image || null));
  }, [t.id]);
  const rows = (t.needs || []).filter((n) => n.type === "review") as (AgentTask["needs"][number] & { value?: string; info?: boolean; changed?: boolean })[];
  const changed = rows.filter((r) => r.changed).length;
  const legal = (l: string) => /authori[sz]|sponsor|citizen|visa|convict|criminal|veteran|disab|gender|race|ethnic|hispanic|salary|certify|attest|agree|consent|true and (complete|correct)/i.test(l);
  return (
    <div className="card border-brand/30 p-5">
      {head}
      <p className="mt-2 text-sm">
        <span className="font-semibold">
          {changed
            ? `${t.job.company}'s form asked ${changed} thing${changed > 1 ? "s" : ""} you hadn't seen yet — nothing has been sent.`
            : `Your first application on ${t.job.company}'s kind of careers site is filled in and waiting — nothing has been sent.`}
        </span>{" "}
        Check the answers below{changed ? " (new ones are marked)" : ""}. Whatever is submitted is a statement in your name.
      </p>
      <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-line last:border-0 ${legal(r.label) ? "bg-orange/5" : ""}`}>
                <td className="w-1/2 px-3 py-2 align-top text-muted">{r.changed && <span className="mr-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">New</span>}{r.label}</td>
                <td className={`px-3 py-2 align-top ${r.info ? "text-muted" : "font-medium"} whitespace-pre-wrap break-words`}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Highlighted rows are eligibility or legal statements. Ticked boxes show as “Checked”. Files are the resume and cover letter in the buttons below.</p>
      {shot && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-ink">See the filled form</summary>
          <a href={`data:image/jpeg;base64,${shot}`} target="_blank" rel="noopener noreferrer"><img src={`data:image/jpeg;base64,${shot}`} alt={`The filled ${t.job.company} application`} className="mt-2 w-full rounded-lg border border-line" /></a>
        </details>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => act({ action: "approve" }, "Approved — your agent is submitting exactly these answers.")}><Check size={16} /> Looks right — submit</button>
        {t.resume_id && <a className="btn-secondary" href={`/api/resume/${t.resume_id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><FileText size={16} /> Resume</a>}
        {t.resume_id && t.cover_letter && <a className="btn-secondary" href={`/api/resume/${t.resume_id}/pdf?kind=cover&inline=1`} target="_blank" rel="noopener noreferrer">Cover letter</a>}
        <a className="btn-ghost" href={t.job.url || t.apply_url} target="_blank" rel="noopener noreferrer">Fix it myself <ExternalLink size={15} /></a>
        <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Skipped — nothing was sent.")}><X size={16} /> Don&apos;t send</button>
      </div>
      <p className="mt-3 text-xs text-muted">After you approve one application on this kind of site, later ones go straight through. You can turn reviews off in Settings.</p>
    </div>
  );
}

function NeedCard({ t, hasMailbox, consent, onDone, onOpen }: { t: AgentTask; hasMailbox: boolean; consent: boolean; onDone: (msg: string) => void; onOpen?: (t: AgentTask) => void }) {
  // Eligibility questions come with what your profile suggests, pre-selected — you confirm it for this exact wording.
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries((t.needs || []).filter((n) => n.suggest).map((n) => [n.id, n.suggest as string])));
  const [busy, setBusy] = useState(false);
  const [always, setAlways] = useState(true);
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
              {n.locked && (
                <span className="mt-1 flex items-start gap-1.5 rounded-lg bg-orange/10 px-2.5 py-1.5 text-xs font-normal text-ink-2">
                  <ShieldCheck size={14} className="mt-px shrink-0 text-orange" aria-hidden />
                  <span>
                    This is a statement in your name, so your agent never guesses it. {n.suggest ? "We pre-selected what your profile says — check it’s true for this exact question." : "Pick the answer that's true for you."} It&apos;s reused only for this exact wording.
                  </span>
                </span>
              )}
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
        <p className="mt-2 text-sm">{t.job.company}&apos;s site wants a step only a person can do (a quick “I&apos;m human” check or a sign-in). Everything else is filled. Open it on {t.job.company}&apos;s site — the Vantage extension fills the form in your Chrome and you press Submit.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {onOpen && <button className="btn-primary" onClick={() => onOpen(t)}><ExternalLink size={16} /> Finish on {t.job.company}&apos;s site</button>}
          <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Skipped — nothing was sent.")}>Skip this job</button>
        </div>
      </div>
    );
  }
  if (t.status === "waiting_code") return <CodeCard t={t} hasMailbox={hasMailbox} head={head} onDone={onDone} />;
  if (t.status === "awaiting_approval" && t.needs?.some((n) => n.type === "review")) return <ReviewCard t={t} head={head} busy={busy} act={act} />;
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
  if (t.submit_clicked_at) {
    // Submit was pressed but no confirmation was seen: it may already be with the employer. Never offer a re-send.
    return (
      <div className="card border-orange/30 p-5">
        {head}
        <p className="mt-2 text-sm"><b>Submit was pressed, but {t.job.company}&apos;s site didn&apos;t show a confirmation.</b> It may already be sent — applying again could send it twice.</p>
        <p className="mt-1 text-xs text-muted">Check your job email for a receipt from {t.job.company}. Receipts are matched automatically and this card updates by itself. If nothing arrives within a day, open the job and check your account on their site.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-secondary" href={t.job.url || t.apply_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open the job</a>
          <Link className="btn-ghost" href="/app/inbox">Check my inbox</Link>
          <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Dismissed.")}>Dismiss</button>
        </div>
      </div>
    );
  }
  return (
    <div className="card p-5">
      {head}
      <p className="mt-2 text-sm">{t.error || t.step || "This application needs you to finish it on the company's site."}</p>
      <p className="mt-1 text-xs text-muted">Nothing was submitted. <b>Finish on {t.job.company}&apos;s site</b> opens the job in your Chrome: the Vantage extension fills every page with your tailored resume and saved answers, and you press Submit.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpen ? <button className="btn-primary" onClick={() => onOpen(t)}><ExternalLink size={16} /> Finish on {t.job.company}&apos;s site</button>
          : <a className="btn-primary" href={`${(t.apply_url || t.job.url).split("#")[0]}#vantage-apply`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Finish on {t.job.company}&apos;s site</a>}
        <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "retry" }, "Your agent will try again.")}><RotateCcw size={16} /> Try again</button>
        <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" }, "Dismissed.")}>Dismiss</button>
      </div>
    </div>
  );
}


/** Why the agent handed a job over, in a few plain words. */
function handoverReason(t: AgentTask) {
  const e = `${t.error || ""} ${t.step || ""}`;
  if (t.submit_clicked_at) return "Submit was pressed but no confirmation showed — it may already be sent. Check your email before doing anything.";
  if (/sign-in|create-account|account|log ?in|password/i.test(e)) return "The site's sign-in or account step needs you.";
  if (/human check|captcha|security verification|cloudflare/i.test(e)) return "The site asked for a human check.";
  if (/resume upload/i.test(e)) return "The site wouldn't take the resume upload.";
  if (/verification|verify/i.test(e)) return "The site wants you to verify your email.";
  if (/too long|slow/i.test(e)) return "The site was too slow for your agent.";
  if (/18 or older/i.test(e)) return "Waiting since the age check — press Try again.";
  if (/no longer available|closed/i.test(e)) return "The posting may have closed.";
  return "A step your agent couldn't do by itself.";
}

/**
 * Jobs your agent couldn't finish on its own: one row each, one clear action — open it on the company's site, where
 * the Vantage extension fills every page in your Chrome and you press Submit.
 */
function FinishOnSite({ tasks, onOpen, onDone }: { tasks: AgentTask[]; onOpen: (t: AgentTask) => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  async function act(t: AgentTask, body: Record<string, unknown>, msg: string) {
    setBusy(t.id);
    const r = await patch(t.id, body);
    setBusy(null);
    onDone(r.ok ? msg : r.error || "Something went wrong.");
  }
  const list = all ? tasks : tasks.slice(0, 6);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-line p-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">Finish on the company&apos;s site · {tasks.length}</h3>
          <p className="mt-0.5 text-sm text-muted">Nothing was sent for these. <b className="text-ink">Open on site</b> opens the job in your Chrome — the Vantage extension fills every page with your tailored resume and saved answers, and you press Submit.</p>
        </div>
        <Link href="/app/extension" className="btn-ghost min-h-9 shrink-0 text-[13px]">Get the extension</Link>
      </div>
      <ul className="divide-y divide-line">
        {list.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={tintFor(t.job.company)}>{initials(t.job.company)}</span>
            <div className="min-w-0 flex-1 basis-60">
              <p className="truncate font-semibold">{t.job.title}</p>
              <p className="truncate text-xs text-muted">{t.job.company} · {handoverReason(t)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {t.submit_clicked_at ? (
                <Link className="btn-secondary min-h-9 text-[13px]" href="/app/inbox">Check my inbox</Link>
              ) : (
                <button className="btn-primary min-h-9 text-[13px]" onClick={() => onOpen(t)}><ExternalLink size={14} /> Open on {t.job.company.length > 14 ? "site" : `${t.job.company}'s site`}</button>
              )}
              {!t.submit_clicked_at && <button className="btn-ghost min-h-9 px-2.5 text-[13px]" disabled={busy === t.id} onClick={() => void act(t, { action: "retry" }, `Your agent will try ${t.job.company} again.`)} title="Let your agent try again"><RotateCcw size={14} /> Retry</button>}
              <button className="btn-ghost min-h-9 px-2.5 text-[13px] text-muted" disabled={busy === t.id} onClick={() => void act(t, { action: "cancel" }, "Dismissed — nothing was sent.")} aria-label={`Dismiss ${t.job.title} at ${t.job.company}`}><X size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
      {tasks.length > 6 && <button className="w-full border-t border-line py-2.5 text-sm font-semibold text-brand-ink hover:bg-canvas/60" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${tasks.length}`}</button>}
    </div>
  );
}

/** "Answer once, before applying": every question the waiting jobs asked, deduplicated, in one form. */
function AskOnce({ tasks, onDone }: { tasks: AgentTask[]; onDone: (m: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { n: AgentTask["needs"][number]; companies: string[] }>();
    for (const t of tasks) for (const raw of t.needs || []) {
      if (isCodeQuestion(raw.label || "")) continue; // codes are read from the mailbox, never saved as answers
      if (isVoluntaryId(raw.label || "") && !raw.locked) continue; // voluntary self-ID: Vantage answers "decline" unless you set it in Settings
      const n = tidy(raw);
      const g = m.get(n.qkey || n.label);
      if (g) { if (!g.companies.includes(t.job.company)) g.companies.push(t.job.company); }
      else m.set(n.qkey || n.label, { n, companies: [t.job.company] });
    }
    return [...m.values()];
  }, [tasks]);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(groups.filter((g) => g.n.suggest).map((g) => [g.n.qkey || g.n.label, g.n.suggest as string])));
  const [busy, setBusy] = useState(false);
  const key = (n: AgentTask["needs"][number]) => n.qkey || n.label;
  const done = groups.filter((g) => vals[key(g.n)]?.trim()).length;
  async function save() {
    setBusy(true);
    const answers = groups.filter((g) => vals[key(g.n)]?.trim()).map((g) => ({ question: g.n.label, answer: vals[key(g.n)], kind: g.n.type }));
    const r = await fetch("/api/agent/answers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    onDone(r?.ok ? `Saved ${d.saved} answer${d.saved === 1 ? "" : "s"} to your memory.${d.freed ? ` ${d.freed} job${d.freed > 1 ? "s are" : " is"} back in line — your agent is applying.` : ""}` : d.error || "Couldn't save.");
  }
  return (
    <section id="answer-once" className="mt-6 scroll-mt-20" aria-labelledby="ask-once">
      <div className="card border-orange/30 p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-orange-ink">Before your agent applies</p>
        <h2 id="ask-once" className="mt-1 text-xl font-bold">{groups.length} question{groups.length > 1 ? "s" : ""} — answer once, and {tasks.length} job{tasks.length > 1 ? "s go" : " goes"} through</h2>
        <p className="mt-1 text-sm text-muted">These companies&apos; forms ask things only you can answer. Each answer is saved to your memory and reused whenever any company asks the same thing.</p>
        <div className="mt-5 space-y-4">
          {groups.map(({ n, companies }) => (
            <fieldset key={key(n)} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                <span className="rounded-full bg-canvas px-2.5 py-1 text-ink-2">{companies.slice(0, 3).join(", ")}{companies.length > 3 ? ` +${companies.length - 3}` : ""}</span>
                {n.locked && <span className="rounded-full bg-red-tint px-2.5 py-1 text-red-ink">Statement in your name — only you can answer</span>}
              </div>
              <legend className="sr-only">{n.label}</legend>
              <p className="mt-2 text-[15px] font-semibold">{n.label}</p>
              {n.suggest && <p className="mt-1 text-xs text-muted">Suggested from your profile: <b className="text-ink">{n.suggest}</b> — change it if that&apos;s wrong for this question.</p>}
              {n.options?.length ? (
                n.options.length <= 5 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.options.filter((o) => !/^(select|choose|--)/i.test(o.trim())).map((o) => (
                      <button type="button" key={o} onClick={() => setVals({ ...vals, [key(n)]: o })} aria-pressed={vals[key(n)] === o}
                        className={`min-h-10 rounded-lg border px-3.5 text-sm font-medium ${vals[key(n)] === o ? "border-brand bg-brand text-white" : "border-line hover:bg-canvas"}`}>{o}</button>
                    ))}
                  </div>
                ) : (
                  <select className="input mt-2" value={vals[key(n)] || ""} onChange={(e) => setVals({ ...vals, [key(n)]: e.target.value })} aria-label={n.label}>
                    <option value="">Choose…</option>
                    {n.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                )
              ) : n.type === "textarea" ? (
                <textarea className="input mt-2 py-2.5" rows={3} value={vals[key(n)] || ""} onChange={(e) => setVals({ ...vals, [key(n)]: e.target.value })} aria-label={n.label} />
              ) : (
                <input className="input mt-2" value={vals[key(n)] || ""} onChange={(e) => setVals({ ...vals, [key(n)]: e.target.value })} aria-label={n.label} />
              )}
            </fieldset>
          ))}
        </div>
        <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-[0_8px_24px_rgba(16,20,42,0.12)]">
          <p className="min-w-0 flex-1 text-sm"><b>{done} of {groups.length} answered.</b> <span className="text-muted">Jobs with every question answered go back in line right away.</span></p>
          <button className="btn-primary" disabled={busy || !done} onClick={() => void save()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save answers and apply</button>
        </div>
      </div>
    </section>
  );
}
