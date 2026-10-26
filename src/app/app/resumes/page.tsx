"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ClipboardPaste, Download, FileText, Loader2, MessageSquareText, PenLine, RefreshCw, Sparkles, Target, TrendingUp, UploadCloud, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { LETTER_TONES, RESUME_STYLES } from "@/lib/resume/styles";
import { rate, styleStats } from "@/lib/resume/learn";
import type { Coach } from "@/lib/resume/coach";
import { RoleCoach } from "@/components/role-coach";
import type { LetterTone, Resume, ResumeStyle } from "@/lib/types";

type R = Resume & { notes?: string[]; kind?: string | null };
type RoleRow = { id: string; title: string; levels: string[]; active: boolean; coach: Coach };
type AppLite = { status: string; target_role_id: string | null; resume_style: string | null; letter_tone: string | null };

const FIT = {
  strong: { label: "Strong fit", cls: "bg-green-tint text-green-ink" },
  adjacent: { label: "Close fit", cls: "bg-brand-tint text-brand-ink" },
  switch: { label: "Career move", cls: "bg-pink-tint text-pink-ink" },
} as const;

export default function ResumesPage() {
  const { userId } = useMe();
  const [list, setList] = useState<R[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [apps, setApps] = useState<AppLite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [coachFor, setCoachFor] = useState<RoleRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const assessing = useRef(false);

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [r, t, a] = await Promise.all([
      s.from("resumes").select("id,target_role_id,name,is_master,level_format,style,content,ats_score,updated_at,notes,kind").neq("kind", "tailored").order("updated_at", { ascending: false }),
      s.from("target_roles").select("id,title,levels,active,coach").order("priority").order("created_at"),
      s.from("applications").select("status,target_role_id,resume_style,letter_tone").limit(5000),
    ]);
    setList((r.data as R[]) || []);
    setRoles(((t.data as RoleRow[]) || []).filter((x) => x.active));
    setApps((a.data as AppLite[]) || []);
  }, []);
  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const master = list?.find((r) => r.is_master);

  // Read how each role fits the master resume (once a week), in the background.
  useEffect(() => {
    if (!master || assessing.current) return;
    const todo = roles.filter((r) => !r.coach?.fit || r.coach.v !== 2);
    if (!todo.length) return;
    assessing.current = true;
    (async () => {
      for (const r of todo) {
        const res = await fetch("/api/resume/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assess", roleId: r.id }) }).catch(() => null);
        const d = res?.ok ? await res.json() : null;
        if (d?.coach) setRoles((rs) => rs.map((x) => (x.id === r.id ? { ...x, coach: d.coach } : x)));
      }
      assessing.current = false;
    })();
  }, [master, roles]);

  async function upload(file: File) {
    setBusy("upload");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/resume/import", { method: "POST", body: fd }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't read that file.");
    setToast(d.roles ? `Resume imported. Rewriting your ${d.roles} role resumes now — about a minute.` : "Resume imported.");
    load();
    if (d.roles) setTimeout(load, 40000);
  }
  async function importText() {
    if (!paste) return;
    setBusy("upload");
    const r = await fetch("/api/resume/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste }) });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return setToast(d.error);
    setPaste(null);
    setToast("Resume imported. Check it and fix anything we misread.");
    load();
    if (d.roles) setTimeout(load, 40000);
  }
  async function writeRole(roleId: string) {
    setBusy(roleId);
    const r = await fetch("/api/resume/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleId }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't write that resume.");
    setToast(`Rewritten — ATS ${d.score}.${d.ai ? "" : " Connect an AI key for recruiter-grade writing."}`);
    load();
  }
  async function rebuild() {
    setBusy("rebuild");
    const r = await fetch("/api/resume/rebuild", { method: "POST" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't rebuild.");
    setToast(`${d.rebuilt ? "Master resume re-read from your file. " : ""}Rewriting your ${d.roles} role resumes like a top recruiter — about a minute.`);
    load();
    setTimeout(load, 45000);
    setTimeout(load, 90000);
  }
  async function setStyle(id: string, style: ResumeStyle) {
    await supabaseBrowser().from("resumes").update({ style }).eq("id", id);
    setList((l) => l?.map((r) => (r.id === id ? { ...r, style } : r)) || null);
  }

  const st = styleStats(apps);
  const totalSent = apps.filter((a) => !["saved", "ready"].includes(a.status)).length;

  return (
    <>
      <PageHeader
        title="Resumes"
        subtitle="One master resume and one sharp resume per target role. Every job gets its own tailored copy automatically — you'll find it with that application."
        actions={master ? <>
          <button className="btn-secondary" onClick={() => setPaste("")}><ClipboardPaste size={16} /> Paste text</button>
          <button className="btn-primary" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />} Upload newer resume</button>
        </> : undefined}
      />
      <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />

      {list === null && <div className="skeleton h-72" />}

      {list && !master && (
        <section
          className={`card mb-6 border-2 border-dashed px-6 py-14 text-center transition ${drag ? "border-brand bg-brand-soft" : "border-line"}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tint text-brand"><UploadCloud size={26} /></span>
          <p className="mt-4 text-lg font-semibold">Start with your current resume</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">PDF or Word. We keep every fact exactly, then write a recruiter-grade resume for each role you&apos;re targeting.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button className="btn-primary" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />} Choose file</button>
            <button className="btn-ghost" onClick={() => setPaste("")}>Paste text instead</button>
          </div>
        </section>
      )}

      {master && (
        <section className="card mb-6 grid overflow-hidden lg:grid-cols-[300px_1fr]"
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}>
          <Link href={`/app/resumes/${master.id}`} className={`relative block bg-canvas p-5 transition ${drag ? "bg-brand-soft" : ""}`} aria-label="Open master resume">
            <MiniPaper r={master} />
          </Link>
          <div className="flex flex-col p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master resume</p>
                <h2 className="mt-1 text-xl font-bold">{titleCase(master.content.name || "Your resume")}</h2>
                <p className="text-sm text-muted">{master.content.headline || master.content.experience?.[0]?.title || "All your verified experience"} · updated {timeAgo(master.updated_at)}</p>
              </div>
              <Score n={master.ats_score} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[["Roles", master.content.experience?.length || 0], ["Skills", (master.content.skills || []).reduce((n, g) => n + g.items.length, 0)], ["Years", years(master)]].map(([l, n]) => (
                <div key={l as string} className="rounded-xl bg-canvas py-2.5"><p className="text-lg font-bold">{n}</p><p className="text-xs text-muted">{l}</p></div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">This is the source of truth: every role resume and job copy is built from it, and nothing is ever invented. Keep it complete — drop a newer file anywhere on this card to update it.</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <Link href={`/app/resumes/${master.id}`} className="btn-secondary min-h-9 text-[13px]"><PenLine size={15} /> Review & edit</Link>
              <a href={`/api/resume/${master.id}/pdf`} className="btn-secondary min-h-9 text-[13px]"><Download size={15} /> PDF</a>
              <StyleSelect r={master} onStyle={setStyle} />
              <button className="btn-ghost min-h-9 text-[13px]" disabled={busy === "rebuild"} onClick={rebuild}>{busy === "rebuild" ? <><Loader2 size={15} className="animate-spin" /> Rebuilding…</> : <><RefreshCw size={15} /> Rebuild everything with AI</>}</button>
            </div>
          </div>
        </section>
      )}

      {master && (
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Your resume for each target role</h2>
              <p className="text-sm text-muted">Written like a top recruiter for that role, from your real experience. Moving into a new field? Tell us what you know and we&apos;ll position you for it.</p>
            </div>
            <Link href="/app/targets" className="btn-ghost min-h-9 text-[13px]"><Target size={15} /> Manage roles</Link>
          </div>
          {roles.length === 0 ? (
            <EmptyState title="Add a target role" body="Each role you target gets one focused resume." action={<Link href="/app/targets" className="btn-primary">Add a role</Link>} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {roles.map((role) => {
                const r = list?.find((x) => !x.is_master && x.target_role_id === role.id && (x.kind || "role") === "role");
                const fit = role.coach?.fit;
                const sent = apps.filter((a) => a.target_role_id === role.id && !["saved", "ready"].includes(a.status));
                const won = sent.filter((a) => ["interview", "offer"].includes(a.status)).length;
                const coached = Boolean(role.coach?.answers?.some((x) => x.a.trim()));
                return (
                  <article key={role.id} className="card flex flex-col p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand"><FileText size={20} /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[17px] font-bold">{titleCase(role.title)}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {fit ? <span className={`chip ${FIT[fit.level].cls}`}>{FIT[fit.level].label}</span> : <span className="chip bg-[#eef0f4] text-muted"><Loader2 size={12} className="animate-spin" /> Checking fit</span>}
                          {coached && <span className="chip bg-green-tint text-green-ink"><Check size={12} /> Coached</span>}
                          {r && <span className="text-xs text-muted">updated {timeAgo(r.updated_at)}</span>}
                        </div>
                      </div>
                      {r && <Score n={r.ats_score} small />}
                    </div>
                    {fit && <p className="mt-3 text-sm text-ink-2">{fit.why}</p>}
                    {fit && (fit.matched.length > 0 || fit.missing.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {fit.matched.slice(0, 5).map((k) => <span key={k} className="chip bg-green-tint/70 text-green-ink">{k}</span>)}
                        {fit.missing.slice(0, 4).map((k) => <span key={k} className="chip border border-dashed border-orange/40 bg-white text-orange-ink">{k}</span>)}
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-lg bg-canvas py-2"><p className="font-bold">{sent.length}</p><p className="text-[11px] text-muted">Sent</p></div>
                      <div className="rounded-lg bg-canvas py-2"><p className="font-bold">{won}</p><p className="text-[11px] text-muted">Interviews</p></div>
                      <div className="rounded-lg bg-canvas py-2"><p className="font-bold">{sent.length ? `${Math.round((won / sent.length) * 100)}%` : "—"}</p><p className="text-[11px] text-muted">Hit rate</p></div>
                    </div>
                    {!!r?.notes?.length && (
                      <details className="mt-3 rounded-lg bg-orange-tint/50 px-3 py-2 text-xs text-orange-ink">
                        <summary className="cursor-pointer font-semibold">{r.notes.length} ways to make it stronger</summary>
                        <ul className="mt-1.5 space-y-1">{r.notes.slice(0, 5).map((n) => <li key={n}>• {n}</li>)}</ul>
                      </details>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                      {fit && fit.level !== "strong" && (
                        <button className="btn-pink min-h-9 text-[13px]" onClick={() => setCoachFor(role)}><MessageSquareText size={15} /> {coached ? "Update what you know" : "Tell us what you know"}</button>
                      )}
                      {r ? <>
                        <Link href={`/app/resumes/${r.id}`} className="btn-secondary min-h-9 text-[13px]">Open</Link>
                        <a href={`/api/resume/${r.id}/pdf`} className="rounded-lg p-2 text-subtle hover:bg-canvas" aria-label="Download PDF"><Download size={17} /></a>
                        <StyleSelect r={r} onStyle={setStyle} />
                      </> : null}
                      <button className="btn-ghost ml-auto min-h-9 text-[13px]" disabled={busy === role.id} onClick={() => writeRole(role.id)}>
                        {busy === role.id ? <><Loader2 size={14} className="animate-spin" /> Writing…</> : r ? <><RefreshCw size={14} /> Rewrite</> : <><Sparkles size={14} /> Write it</>}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {master && totalSent > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><TrendingUp size={17} className="text-brand" /> What gets you interviews</h2>
          <p className="text-sm text-muted">From {totalSent} sent applications. Your agent leans toward what wins and keeps testing the rest.</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <Bars title="Resume style" rows={(Object.keys(RESUME_STYLES) as ResumeStyle[]).map((k) => ({ k: RESUME_STYLES[k].label, s: st.styles[k] }))} />
            <Bars title="Cover letter tone" rows={(Object.keys(LETTER_TONES) as LetterTone[]).map((k) => ({ k: LETTER_TONES[k].label, s: st.tones[k] }))} />
          </div>
        </section>
      )}

      {master && (
        <Link href="/app/applications" className="card mb-6 flex items-center gap-3 p-4 hover:border-[#c9d5fb]">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas text-ink-2"><FileText size={18} /></span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">Job-specific copies</span><span className="block text-sm text-muted">Each application keeps the exact resume and cover letter that was sent. Open any application to see them.</span></span>
          <ArrowRight size={18} className="text-subtle" />
        </Link>
      )}

      {paste !== null && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Paste your resume">
          <div className="card w-full max-w-2xl p-5">
            <div className="flex items-center"><h2 className="flex-1 text-lg font-bold">Paste your resume</h2><button className="rounded-lg p-2 hover:bg-canvas" aria-label="Close" onClick={() => setPaste(null)}><X size={18} /></button></div>
            <textarea rows={14} className="input mt-3 py-3 text-sm" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the full text of your resume" aria-label="Resume text" />
            <div className="mt-3 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setPaste(null)}>Cancel</button><button className="btn-primary" disabled={busy === "upload" || paste.trim().length < 80} onClick={importText}>{busy === "upload" && <Loader2 size={16} className="animate-spin" />} Import</button></div>
          </div>
        </div>
      )}

      {coachFor && <RoleCoach role={coachFor} onClose={() => setCoachFor(null)} onDone={(msg) => { setCoachFor(null); setToast(msg); load(); }} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

const titleCase = (t: string) => (t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : t);

function years(r: R) {
  const ys = (r.content.experience || []).flatMap((e) => [e.start, e.end]).map((d) => (d && /present/i.test(d) ? new Date().getFullYear() : parseInt((d || "").match(/\d{4}/)?.[0] || "", 10))).filter((n) => !isNaN(n));
  return ys.length ? Math.max(0, Math.max(...ys) - Math.min(...ys)) : "—";
}

function Score({ n, small }: { n: number | null; small?: boolean }) {
  if (n == null) return null;
  const size = small ? 46 : 64, stroke = small ? 5 : 6, rad = (size - stroke) / 2, c = 2 * Math.PI * rad;
  const color = n >= 80 ? "var(--color-green)" : n >= 60 ? "var(--color-brand)" : "var(--color-orange)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`ATS score ${n} of 100`}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--color-line-2)" strokeWidth={stroke} /><circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - n / 100)} /></svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none"><span className={`${small ? "text-sm" : "text-lg"} font-bold`}>{n}</span><span className="text-[9px] font-semibold text-muted">ATS</span></span>
    </div>
  );
}

function MiniPaper({ r }: { r: R }) {
  const c = r.content;
  return (
    <div className="mx-auto aspect-[8.5/11] w-full max-w-[240px] overflow-hidden rounded-md border border-line bg-white p-4 text-[6.5px] leading-[1.45] text-ink shadow-[0_8px_24px_rgba(16,24,40,.08)]">
      <p className="text-center text-[11px] font-bold">{c.name}</p>
      <p className="text-center text-muted">{[c.location, c.email, c.phone].filter(Boolean).join(" · ")}</p>
      {c.summary && <><p className="mt-2 border-b border-line pb-0.5 font-bold uppercase tracking-wide">Summary</p><p className="mt-0.5 line-clamp-3">{c.summary}</p></>}
      <p className="mt-2 border-b border-line pb-0.5 font-bold uppercase tracking-wide">Experience</p>
      {(c.experience || []).slice(0, 3).map((e, i) => (
        <div key={i} className="mt-1">
          <p className="flex justify-between font-semibold"><span className="truncate">{e.title}</span><span className="shrink-0 text-muted">{e.start}–{e.end}</span></p>
          <p className="text-muted">{e.company}</p>
          {(e.bullets || []).slice(0, 2).map((b, j) => <p key={j} className="line-clamp-1">• {b}</p>)}
        </div>
      ))}
      {!!c.skills?.length && <><p className="mt-2 border-b border-line pb-0.5 font-bold uppercase tracking-wide">Skills</p><p className="line-clamp-2">{c.skills.flatMap((g) => g.items).slice(0, 14).join(" · ")}</p></>}
    </div>
  );
}

function StyleSelect({ r, onStyle }: { r: R; onStyle: (id: string, s: ResumeStyle) => void }) {
  return (
    <select aria-label="Resume design" className="input h-9 w-[146px] py-0 text-xs" value={r.style || "classic"} onChange={(e) => onStyle(r.id, e.target.value as ResumeStyle)}>
      {(Object.keys(RESUME_STYLES) as ResumeStyle[]).map((s) => <option key={s} value={s}>{RESUME_STYLES[s].label} design</option>)}
    </select>
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
              <span className="text-right text-xs text-muted">{pct === null ? "testing" : `${pct}% · ${r.s!.interviews}/${r.s!.sent}`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

