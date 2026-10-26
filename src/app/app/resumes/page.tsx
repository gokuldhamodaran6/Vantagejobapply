"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Sparkles, TrendingUp, UploadCloud } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { LETTER_TONES, RESUME_STYLES } from "@/lib/resume/styles";
import { rate, styleStats } from "@/lib/resume/learn";
import type { LetterTone, Resume, ResumeStyle } from "@/lib/types";

export default function ResumesPage() {
  const { roles, userId } = useMe();
  const [list, setList] = useState<(Resume & { notes?: string[] })[] | null>(null);
  const [stats, setStats] = useState<ReturnType<typeof styleStats> | null>(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [r, a] = await Promise.all([
      s.from("resumes").select("*").order("is_master", { ascending: false }).order("updated_at", { ascending: false }),
      s.from("applications").select("status,resume_style,letter_tone"),
    ]);
    setList((r.data as (Resume & { notes?: string[] })[]) || []);
    setStats(styleStats((a.data as { status: string; resume_style: string | null; letter_tone: string | null }[]) || []));
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  async function upload(file: File) {
    setBusy("upload");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/resume/import", { method: "POST", body: fd }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't read that file.");
    setToast(d.roles ? `Resume imported. Writing a targeted resume for each of your ${d.roles} roles now…` : "Resume imported.");
    load();
    if (d.roles) setTimeout(load, 25000);
  }
  async function importText() {
    setBusy("upload");
    const r = await fetch("/api/resume/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste }) });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return setToast(d.error);
    setPaste("");
    setShowPaste(false);
    setToast("Resume imported. Review it and fix anything we misread.");
    load();
    if (d.roles) setTimeout(load, 25000);
  }
  async function writeRole(roleId: string) {
    setBusy(roleId);
    const r = await fetch("/api/resume/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleId }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't write that resume.");
    setToast(`Done — ATS score ${d.score}.${d.ai ? "" : " Add an AI key for recruiter-grade rewriting."}`);
    load();
  }
  async function setStyle(id: string, style: ResumeStyle) {
    await supabaseBrowser().from("resumes").update({ style }).eq("id", id);
    setList((l) => l?.map((r) => (r.id === id ? { ...r, style } : r)) || null);
  }

  const master = list?.find((r) => r.is_master);
  const roleResumes = list?.filter((r) => !r.is_master && r.target_role_id && !r.name.includes(" — ")) || [];
  const jobResumes = list?.filter((r) => !r.is_master && r.name.includes(" — ")) || [];
  const sent = Object.values(stats?.styles || {}).reduce((n, s) => n + s.sent, 0);

  return (
    <>
      <PageHeader title="Resumes" subtitle="One master resume, a targeted resume per role, and a tailored copy for every job your agent applies to." />

      <section
        className={`card mb-6 border-2 border-dashed p-6 text-center transition ${drag ? "border-brand bg-brand-soft" : "border-line"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
      >
        <UploadCloud className="mx-auto text-brand" size={30} />
        <p className="mt-2 font-semibold">{master ? "Upload a newer resume" : "Upload your resume"}</p>
        <p className="text-sm text-muted">PDF or Word. We read it carefully, keep every fact, and build clean, ATS-ready versions.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn-primary" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />} Choose file</button>
          <button className="btn-ghost" onClick={() => setShowPaste(!showPaste)}>Paste text instead</button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        {showPaste && (
          <div className="mt-4 text-left">
            <textarea rows={8} className="input py-3 text-sm" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste your resume here" aria-label="Resume text" />
            <button className="btn-secondary mt-2" disabled={busy === "upload" || paste.trim().length < 80} onClick={importText}>Import text</button>
          </div>
        )}
      </section>

      {list === null && <div className="skeleton h-60" />}

      {master && (
        <section className="mb-6">
          <h2 className="mb-3 font-semibold">Master resume</h2>
          <ResumeRow r={master} label="All your verified experience" onStyle={setStyle} />
        </section>
      )}

      {master && (
        <section className="mb-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="font-semibold">By target role</h2>
            <p className="text-xs text-muted">Rewritten by a recruiter-grade writer for each role, using only your real experience.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {roles.map((role) => {
              const r = roleResumes.find((x) => x.target_role_id === role.id);
              return (
                <div key={role.id} className="space-y-2">
                  {r ? <ResumeRow r={r} label={role.title} onStyle={setStyle} /> : (
                    <div className="card flex items-center gap-3 border-dashed p-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-tint text-brand"><Sparkles size={18} /></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold">{role.title} resume</span><span className="block text-sm text-muted">Not written yet</span></span>
                    </div>
                  )}
                  <button className="btn-ghost min-h-8 w-full text-xs" disabled={busy === role.id} onClick={() => writeRole(role.id)}>
                    {busy === role.id ? <><Loader2 size={14} className="animate-spin" /> Writing — about 30 seconds</> : <><Sparkles size={14} /> {r ? "Rewrite with AI" : "Write it with AI"}</>}
                  </button>
                  {!!r?.notes?.length && (
                    <ul className="rounded-lg bg-orange-tint/60 px-3 py-2 text-xs text-orange-ink">
                      {r.notes.slice(0, 3).map((n) => <li key={n}>• {n}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {master && (
        <section className="card mb-6 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><TrendingUp size={17} className="text-brand" /> What&apos;s working</h2>
          <p className="text-sm text-muted">{sent ? `Interview rate by style, from ${sent} sent applications. Your agent leans toward what wins while still testing the others.` : "Once applications go out, you'll see which resume style and letter tone get you the most interviews. Your agent automatically leans toward the winners."}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Bars title="Resume style" rows={(Object.keys(RESUME_STYLES) as ResumeStyle[]).map((k) => ({ k: RESUME_STYLES[k].label, s: stats?.styles[k] }))} />
            <Bars title="Letter tone" rows={(Object.keys(LETTER_TONES) as LetterTone[]).map((k) => ({ k: LETTER_TONES[k].label, s: stats?.tones[k] }))} />
          </div>
        </section>
      )}

      {jobResumes.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Tailored for specific jobs ({jobResumes.length})</h2>
          <div className="grid gap-3 md:grid-cols-2">{jobResumes.slice(0, 40).map((r) => <ResumeRow key={r.id} r={r} label="Tailored copy" onStyle={setStyle} />)}</div>
        </section>
      )}

      {list && master && roles.length === 0 && <EmptyState title="Add target roles" body="Each target role gets its own resume." action={<Link href="/app/targets" className="btn-primary">Add a role</Link>} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function Bars({ title, rows }: { title: string; rows: { k: string; s?: { sent: number; interviews: number } }[] }) {
  const max = Math.max(10, ...rows.map((r) => rate(r.s) || 0));
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-2">
        {rows.map((r) => {
          const pct = rate(r.s);
          return (
            <li key={r.k} className="grid grid-cols-[90px_1fr_92px] items-center gap-3 text-sm">
              <span className="font-medium">{r.k}</span>
              <span className="h-2 overflow-hidden rounded-full bg-line-2"><span className="block h-full rounded-full bg-gradient-to-r from-brand to-pink" style={{ width: `${pct ? (pct / max) * 100 : 0}%` }} /></span>
              <span className="text-right text-xs text-muted">{pct === null ? "no data yet" : `${pct}% · ${r.s!.interviews}/${r.s!.sent}`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResumeRow({ r, label, onStyle }: { r: Resume; label: string; onStyle: (id: string, s: ResumeStyle) => void }) {
  return (
    <div className="card flex items-center gap-3 p-4 hover:border-[#c9d5fb]">
      <Link href={`/app/resumes/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand"><FileText size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{r.name}</span>
          <span className="block truncate text-sm text-muted">{label} · edited {timeAgo(r.updated_at)}</span>
        </span>
      </Link>
      {r.ats_score != null && <span className={`pill hidden sm:inline-flex ${r.ats_score >= 80 ? "bg-green-tint text-green-ink" : r.ats_score >= 60 ? "bg-brand-tint text-brand-ink" : "bg-orange-tint text-orange-ink"}`}>ATS {r.ats_score}</span>}
      <select aria-label="Resume style" className="input h-9 w-[112px] py-0 text-xs" value={r.style || "classic"} onChange={(e) => onStyle(r.id, e.target.value as ResumeStyle)}>
        {(Object.keys(RESUME_STYLES) as ResumeStyle[]).map((s) => <option key={s} value={s}>{RESUME_STYLES[s].label}</option>)}
      </select>
      <a href={`/api/resume/${r.id}/pdf`} className="rounded-lg p-2 text-subtle hover:bg-canvas hover:text-ink" aria-label="Download PDF"><Download size={17} /></a>
    </div>
  );
}
