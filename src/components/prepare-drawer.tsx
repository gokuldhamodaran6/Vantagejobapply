"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, ExternalLink, FileText, Loader2, Sparkles, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, track } from "@/lib/me";
import { workAuthAnswers } from "@/lib/answers";
import { money, timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui";
import type { Job, MatchResult, ResumeContent } from "@/lib/types";

type Tailored = {
  resume: ResumeContent;
  coverLetter: string;
  keywords: string[];
  ai: boolean;
  report: { score: number; matched: string[]; missing: string[] };
  baseResumeId: string;
};

export function PrepareDrawer({ item, onClose, onSaved }: { item: { job: Job; match: MatchResult } | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { auth, userId } = useMe();
  const [job, setJob] = useState<Job | null>(null);
  const [tailored, setTailored] = useState<Tailored | null>(null);
  const [cover, setCover] = useState("");
  const [busy, setBusy] = useState<"" | "tailor" | "save">("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setJob(item?.job || null);
    setTailored(null);
    setCover("");
    setError(null);
    if (item) {
      fetch(`/api/jobs/${encodeURIComponent(item.job.id)}`).then(async (r) => {
        if (r.ok) setJob((await r.json()).job);
      });
    }
  }, [item]);

  if (!item) return null;
  const j = job || item.job;
  const answers = workAuthAnswers(j.country, auth.find((a) => a.country === j.country));

  async function tailor() {
    setBusy("tailor");
    setError(null);
    const r = await fetch("/api/tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id, roleId: item!.match.role?.id || null }) });
    const d = await r.json();
    setBusy("");
    if (!r.ok) return setError(d.error || "Couldn't tailor your resume. Try again.");
    setTailored(d);
    setCover(d.coverLetter);
    track("tailor_view", { job: j.id });
  }

  async function save(status: "saved" | "ready" | "applied") {
    if (!userId) return;
    setBusy("save");
    const supabase = supabaseBrowser();
    let resumeId: string | null = tailored?.baseResumeId || null;
    if (tailored) {
      const r = await supabase.from("resumes").insert({
        user_id: userId, name: `${j.title} — ${j.company}`, is_master: false, target_role_id: item!.match.role?.id || null,
        content: tailored.resume, ats_score: tailored.report.score,
      }).select("id").single();
      if (r.data) resumeId = r.data.id;
    }
    const now = new Date().toISOString();
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
                {j.sponsor_registered && <Badge tone="green">✓ Licensed visa sponsor</Badge>}
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
                  <p className="text-sm text-muted">Rewritten from your verified experience only.</p>
                </div>
                <button className="btn-primary" onClick={tailor} disabled={busy !== ""}>
                  {busy === "tailor" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {tailored ? "Tailor again" : "Tailor for this job"}
                </button>
              </div>
              {error && <p role="alert" className="mt-3 rounded-lg bg-red-tint px-3 py-2 text-sm text-red-ink">{error}{error.includes("resume first") && <> · <Link href="/app/resumes" className="font-semibold underline">Add resume</Link></>}</p>}
              {tailored && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3 rounded-lg bg-canvas p-3">
                    <span className="text-2xl font-bold">{tailored.report.score}</span>
                    <div className="text-sm">
                      <p className="font-semibold">ATS match score</p>
                      <p className="text-muted">{tailored.report.matched.length} of {tailored.keywords.length} keywords from the posting appear{tailored.ai ? " · AI-tailored" : ""}</p>
                    </div>
                  </div>
                  {tailored.report.missing.length > 0 && (
                    <p className="text-sm text-muted">In the posting but not in your history (not added): {tailored.report.missing.slice(0, 8).join(", ")}</p>
                  )}
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

          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-5 py-4">
            <a href={j.url} target="_blank" rel="noopener noreferrer" className="btn-pink" onClick={() => save("ready")}>
              Open official application <ExternalLink size={15} />
            </a>
            <button className="btn-secondary" onClick={() => save("applied")} disabled={busy !== ""}><Check size={16} /> I applied</button>
            <button className="btn-ghost" onClick={() => save("saved")} disabled={busy !== ""}>Save for later</button>
            {tailored && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted"><FileText size={14} /> Tailored resume saves to Resumes</span>
            )}
          </div>
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  );
}
