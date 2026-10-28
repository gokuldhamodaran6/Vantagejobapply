"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, Copy, FileText, Loader2, Puzzle, Sparkles, X } from "lucide-react";
import { askExtension, canOpenFromSite, extensionState, type ExtState } from "@/lib/ext-client";
import { LETTER_TONES, RESUME_STYLES } from "@/lib/resume/styles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, track } from "@/lib/me";
import { workAuthAnswers } from "@/lib/answers";
import { money, timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui";
import { MatchReport, type MatchReportFormat, type MatchReportHarvard, type MatchReportMatch } from "@/components/match-report";
import type { Job, LetterTone, MatchResult, ResumeContent, ResumeStyle } from "@/lib/types";

type Tailored = {
  resume: ResumeContent;
  coverLetter: string;
  keywords: string[];
  ai: boolean;
  tone: LetterTone;
  style: ResumeStyle;
  analysis: { requirement: string; evidence: string | null }[];
  letterIssues: string[];
  report: { score: number; matched: string[]; missing: string[] };
  baseResumeId: string;
  baseName?: string;
  match?: MatchReportMatch;
  harvard?: MatchReportHarvard;
  format?: MatchReportFormat;
};

export function PrepareDrawer({ item, onClose, onSaved }: { item: { job: Job; match: MatchResult } | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { auth, userId } = useMe();
  const [job, setJob] = useState<Job | null>(null);
  const [tailored, setTailored] = useState<Tailored | null>(null);
  const [cover, setCover] = useState("");
  const [busy, setBusy] = useState<"" | "tailor" | "save" | "apply">("");
  const [ext, setExt] = useState<ExtState | null>(null);
  const [opened, setOpened] = useState<{ company: string; viaExt: boolean } | null>(null);
  const [tone, setTone] = useState<LetterTone | null>(null);
  const [style, setStyle] = useState<ResumeStyle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (item) void extensionState().then(setExt);
  }, [item]);

  useEffect(() => {
    setJob(item?.job || null);
    setTailored(null);
    setCover("");
    setError(null);
    setOpened(null);
    if (item) {
      fetch(`/api/jobs/${encodeURIComponent(item.job.id)}`).then(async (r) => {
        if (r.ok) setJob((await r.json()).job);
      });
    }
  }, [item]);

  if (!item) return null;
  const j = job || item.job;
  const answers = workAuthAnswers(j.country, auth.find((a) => a.country === j.country));

  async function tailor(): Promise<Tailored | null> {
    setBusy("tailor");
    setError(null);
    const r = await fetch("/api/tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id, roleId: item!.match.role?.id || null, tone: tone || undefined, style: style || undefined }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setBusy("");
    if (!r?.ok) {
      setError(d.error || "Couldn't write your resume for this job. Try again.");
      return null;
    }
    setTailored(d);
    setCover(d.coverLetter);
    setTone(d.tone);
    setStyle(d.style);
    track("tailor_view", { job: j.id });
    return d as Tailored;
  }

  async function save(status: "saved" | "ready" | "applied") {
    if (!userId) return;
    setBusy("save");
    const supabase = supabaseBrowser();
    let resumeId: string | null = tailored?.baseResumeId || null;
    if (tailored) {
      const r = await supabase.from("resumes").insert({
        user_id: userId, name: `${j.title} — ${j.company}`, is_master: false, target_role_id: item!.match.role?.id || null,
        content: tailored.resume, ats_score: tailored.report.score, style: tailored.style,
      }).select("id").single();
      if (r.data) resumeId = r.data.id;
    }
    const now = new Date().toISOString();
    // Never move an application backwards or wipe its history: if it's already tracked, only add what's new.
    const ORDER = ["saved", "ready", "applied", "in_review", "assessment", "interview", "offer", "rejected", "withdrawn"];
    const { data: existing } = await supabase.from("applications").select("id,status,events,applied_at").eq("user_id", userId).eq("job_id", j.id).maybeSingle();
    if (existing) {
      const cur = String(existing.status);
      const forward = ORDER.indexOf(status) > ORDER.indexOf(cur) && !["rejected", "withdrawn"].includes(cur);
      const ev = { at: now, type: status, text: status === "applied" ? "You applied on the company's official site" : status === "ready" ? "Application prepared" : "Saved" };
      const { error } = await supabase.from("applications").update({
        ...(forward ? { status, ...(status === "applied" ? { applied_at: existing.applied_at || now } : {}) } : {}),
        ...(resumeId ? { resume_id: resumeId } : {}),
        ...(cover ? { cover_letter: cover } : {}),
        events: [...((existing.events as unknown[]) || []), ...(forward ? [ev] : [])],
      }).eq("id", existing.id);
      setBusy("");
      if (error) return setError(error.message);
      onSaved(forward ? (status === "applied" ? "Marked as applied — tracking it in Applications" : "Saved to Applications") : `Already in Applications (${cur.replace("_", " ")}) — nothing was changed`);
      if (status !== "ready") onClose();
      return;
    }
    const { error } = await supabase.from("applications").upsert(
      {
        user_id: userId,
        job_id: j.id,
        job: { title: j.title, company: j.company, url: j.url, country: j.country, location: j.location },
        target_role_id: item!.match.role?.id || null,
        resume_id: resumeId,
        status,
        match_score: item!.match.score,
        cover_letter: cover || null,
        resume_style: tailored?.style || null,
        letter_tone: tailored?.tone || null,
        answers: Object.fromEntries(answers.map((a) => [a.q, a.a])),
        applied_at: status === "applied" ? now : null,
        events: [{ at: now, type: status, text: status === "applied" ? "Applied on the company's official site" : status === "ready" ? "Application prepared" : "Saved" }],
      },
      { onConflict: "user_id,job_id" },
    );
    setBusy("");
    if (error) return setError(error.message);
    track(status === "applied" ? "applied" : "saved", { job: j.id });
    onSaved(status === "applied" ? "Marked as applied — tracking it in Applications" : status === "ready" ? "Application prepared and saved" : "Saved to Applications");
    if (status !== "ready") onClose();
  }

  /**
   * Tailor & apply: write the resume and cover letter for this job (if not done yet), save them, then open the
   * company's own application. With the extension installed it opens the page and fills it; the person presses Submit.
   */
  async function tailorAndApply(force = false) {
    setError(null);
    const ready = Boolean(ext?.connected && canOpenFromSite(ext.version));
    // Without the extension, open the tab now (inside the click) so the browser doesn't block it.
    const win = ready ? null : window.open("", "_blank");
    if (win) win.document.write("<p style='font:16px system-ui;padding:24px'>Preparing your application…</p>");
    const t = tailored || (await tailor());
    if (!t) { win?.close(); return; }
    setBusy("apply");
    const r = await fetch("/api/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: j.id, roleId: item!.match.role?.id || null, resume: t.resume, coverLetter: cover || t.coverLetter, style: t.style, tone: t.tone, atsScore: t.report?.score, force }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error. Try again." };
    setBusy("");
    if (!r?.ok) {
      win?.close();
      setError(d.duplicate ? `${d.error} Open it anyway?` : d.error || "Couldn't open this application.");
      return;
    }
    track("apply_open", { job: j.id, ext: ready });
    if (ready) {
      const sent = await askExtension({ type: "apply", taskId: d.taskId, url: d.url, job: d.job }, 4000);
      if (sent?.ok) return setOpened({ company: j.company, viaExt: true });
      // The extension didn't answer: open the page normally.
      window.open(d.url, "_blank", "noopener");
      return setOpened({ company: j.company, viaExt: false });
    }
    if (win) win.location.href = d.url;
    else window.open(d.url, "_blank", "noopener");
    setOpened({ company: j.company, viaExt: false });
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={`Prepare application: ${j.title}`}>
        <button className="absolute inset-0 bg-ink/30" aria-label="Close" onClick={onClose} />
        <motion.aside
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col bg-white shadow-2xl"
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">{j.company} · {j.location || j.country} · {timeAgo(j.posted_at)}</p>
              <h2 className="mt-0.5 text-xl font-bold leading-tight">{j.title}</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <section>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={item.match.verdict === "great" ? "pink" : "blue"}>{item.match.score}% match</Badge>
                {j.sponsor_registered && <Badge tone="green">{j.country === "US" ? "✓ Has sponsored H-1B visas" : j.country === "GB" ? "✓ Licensed UK visa sponsor" : "✓ Known visa sponsor"}</Badge>}
                {j.sponsorship === "offers" && <Badge tone="green">✓ Mentions sponsorship</Badge>}
                {j.sponsorship === "no" && <Badge tone="red">Says no sponsorship</Badge>}
                {money(j.salary_min, j.salary_max, j.currency) && <Badge tone="gray">{money(j.salary_min, j.salary_max, j.currency)}</Badge>}
              </div>
              {(item.match.reasons.length > 0 || item.match.warnings.length > 0) && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {item.match.reasons.map((r) => <li key={r} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-green" />{r}</li>)}
                  {item.match.warnings.map((r) => <li key={r} className="flex gap-2 text-orange-ink"><span className="mt-0.5 shrink-0">!</span>{r}</li>)}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Resume and cover letter for this job</p>
                  <p className="text-sm text-muted">Written for this job from your real experience. Nothing is invented; gaps are shown, not filled.</p>
                </div>
                <button className="btn-secondary" onClick={() => void tailor()} disabled={busy !== ""}>
                  {busy === "tailor" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {tailored ? "Write again" : "Preview first"}
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Cover letter tone</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(LETTER_TONES) as LetterTone[]).map((t) => (
                      <button key={t} title={LETTER_TONES[t].blurb} onClick={() => setTone(t)} aria-pressed={tone === t} className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold ${tone === t ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>{LETTER_TONES[t].label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Resume style</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(RESUME_STYLES) as ResumeStyle[]).map((t) => (
                      <button key={t} title={RESUME_STYLES[t].blurb} onClick={() => setStyle(t)} aria-pressed={style === t} className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold ${style === t ? "border-brand bg-brand text-white" : "border-line text-ink-2 hover:bg-canvas"}`}>{RESUME_STYLES[t].label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {!tone && !tailored && <p className="mt-2 text-xs text-muted">Leave these unset and Vantage picks the style and tone that are getting you the most interviews.</p>}
              {error && <p role="alert" className="mt-3 rounded-lg bg-red-tint px-3 py-2 text-sm text-red-ink">{error}{error.includes("resume first") && <> · <Link href="/app/resumes" className="font-semibold underline">Add resume</Link></>}</p>}
              {tailored && (
                <div className="mt-4 space-y-4">
                  {tailored.match && tailored.harvard && tailored.format ? (
                    <MatchReport match={tailored.match} harvard={tailored.harvard} format={tailored.format} />
                  ) : (
                    <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{tailored.report.matched.length} of {tailored.keywords.length} key terms from the posting appear in your resume.</p>
                  )}
                  <p className="text-xs text-muted">{RESUME_STYLES[tailored.style]?.label || "Classic"} layout · {LETTER_TONES[tailored.tone]?.label || "Confident"} letter{tailored.ai ? "" : " · basic writer (add an AI key for recruiter-grade writing)"}</p>
                  {tailored.letterIssues?.length > 0 && <p className="rounded-lg bg-orange-tint px-3 py-2 text-xs text-orange-ink">Worth a quick edit: {tailored.letterIssues.slice(0, 3).join("; ")}</p>}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="label mb-0" htmlFor="cover">Cover letter</label>
                      <button className="text-sm font-semibold text-brand-ink" onClick={() => copy(cover, "cover")}>{copied === "cover" ? "Copied" : "Copy"}</button>
                    </div>
                    <textarea id="cover" rows={10} className="input py-3 text-sm leading-relaxed" value={cover} onChange={(e) => setCover(e.target.value)} />
                  </div>
                </div>
              )}
            </section>

            <section>
              <p className="font-semibold">Your answers to the eligibility questions</p>
              <p className="text-sm text-muted">The same truthful answers on every application. Change them in My targets.</p>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {answers.map((a) => (
                  <li key={a.q} className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted">{a.q}</p>
                      <p className="mt-0.5 text-sm font-semibold">{a.a}</p>
                    </div>
                    <button onClick={() => copy(a.a, a.q)} className="rounded p-1.5 text-subtle hover:bg-canvas" aria-label="Copy answer">
                      {copied === a.q ? <Check size={15} className="text-green" /> : <Copy size={15} />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {j.description && (
              <section>
                <p className="font-semibold">About the job</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{j.description.slice(0, 4000)}{j.description.length > 4000 ? "…" : ""}</p>
              </section>
            )}
          </div>

          <div className="border-t border-line bg-white px-5 py-4">
            {opened ? (
              <div className="mb-3 rounded-xl bg-green-tint px-4 py-3 text-sm text-green-ink" role="status">
                {opened.viaExt
                  ? <>Opened {opened.company}&apos;s application in a new tab. The Vantage extension is filling it with this resume and cover letter. Check each page, then press Submit there; it&apos;s recorded in Applications automatically.</>
                  : <>Opened {opened.company}&apos;s application in a new tab. It&apos;s in Applications as Ready. <Link href="/app/extension" className="font-semibold underline">{ext?.installed ? "Update the Chrome extension" : "Add the Chrome extension"}</Link> to have Vantage fill it for you next time.</>}
              </div>
            ) : (
              ext && !(ext.connected && canOpenFromSite(ext.version)) && (
                <p className="mb-3 flex items-start gap-2 text-xs text-muted">
                  <Puzzle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{!ext.installed ? "Add the Vantage Chrome extension" : !ext.connected ? "Connect the Vantage Chrome extension" : "Update the Vantage Chrome extension"} and it fills {j.company}&apos;s form for you. <Link href="/app/extension" className="font-semibold text-brand-ink">Set it up</Link></span>
                </p>
              )
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={() => void tailorAndApply(Boolean(error?.endsWith("Open it anyway?")))} disabled={busy !== ""}>
                {busy === "tailor" || busy === "apply" ? <Loader2 size={16} className="animate-spin" /> : <ArrowUpRight size={16} />}
                {busy === "tailor" ? "Writing your resume…" : busy === "apply" ? `Opening ${j.company}…` : error?.endsWith("Open it anyway?") ? "Open it anyway" : tailored ? `Apply on ${j.company}'s site` : "Tailor & apply"}
              </button>
              <button className="btn-ghost" onClick={() => save("applied")} disabled={busy !== ""}><Check size={16} /> I applied</button>
              <button className="btn-ghost" onClick={() => save("saved")} disabled={busy !== ""}>Save for later</button>
              {tailored && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted"><FileText size={14} /> Saved to Resumes as “{j.title} — {j.company}”</span>
              )}
            </div>
          </div>
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  );
}
