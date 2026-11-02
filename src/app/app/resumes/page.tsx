"use client";
import { repairResume } from "@/lib/resume/repair";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardPaste, Download, FileText, History, Loader2, MessageSquareText, MoreHorizontal, PenLine, RefreshCw, Search, Sparkles, Target, UploadCloud, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { RESUME_STYLES } from "@/lib/resume/styles";
import { checkResume } from "@/lib/resume/check";
import type { Coach } from "@/lib/resume/coach";
import { RoleCoach } from "@/components/role-coach";
import { ResumePaper } from "@/components/resume-paper";
import type { Resume, ResumeStyle } from "@/lib/types";

type R = Resume & { notes?: string[]; kind?: string | null };
type RoleRow = { id: string; title: string; levels: string[]; active: boolean; coach: Coach };
type AppLite = { status: string; target_role_id: string | null; resume_id: string | null; created_at: string };
type Readiness = {
  parse: { ok: number; total: number; bad: string[] };
  roles: { id: string; title: string; postings: number; skills: number; have: number; proven: number; missing: { skill: string; share: number }[]; titleFound: boolean; titleVia: string; found: boolean }[];
  lines: { strong: number; total: number };
  fixes: { role: string; text: string; tip: string; tags: string[] }[];
  stories: { ready: number; total: number } | null;
  versions: { id: string; created_at: string; reason: string }[];
};

const FIT = {
  strong: { label: "Strong fit", cls: "bg-green-tint text-green-ink" },
  adjacent: { label: "Close fit", cls: "bg-brand-tint text-brand-ink" },
  switch: { label: "Career move", cls: "bg-pink-tint text-pink-ink" },
} as const;

/** Templates recruiters read without friction. Modern stays available to anyone already using it. */
const TEMPLATES: ResumeStyle[] = ["classic", "compact", "executive"];
const SENT = (s: string) => !["saved", "ready"].includes(s);
const REPLIED = (s: string) => ["in_review", "assessment", "interview", "offer", "rejected"].includes(s);
const INTERVIEW = (s: string) => ["interview", "offer"].includes(s);

export default function ResumesPage() {
  const { userId, profile } = useMe();
  const [list, setList] = useState<R[] | null>(null);
  const [copies, setCopies] = useState<R[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [apps, setApps] = useState<AppLite[]>([]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [more, setMore] = useState(false);
  const [coachFor, setCoachFor] = useState<RoleRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const assessing = useRef(false);

  const loadReady = useCallback(async () => {
    const r = await fetch("/api/resume/readiness").catch(() => null);
    const d = r?.ok ? await r.json() : null;
    if (d?.parse) setReady(d as Readiness);
  }, []);

  const load = useCallback(async () => {
    const s = supabaseBrowser();
    const [r, t, a, c] = await Promise.all([
      s.from("resumes").select("id,target_role_id,name,is_master,level_format,style,content,ats_score,updated_at,notes,kind").neq("kind", "tailored").order("updated_at", { ascending: false }),
      s.from("target_roles").select("id,title,levels,active,coach").order("priority").order("created_at"),
      s.from("applications").select("status,target_role_id,resume_id,created_at").eq("user_id", userId || "").limit(5000),
      s.from("resumes").select("id,name,style,updated_at,kind,target_role_id").eq("kind", "tailored").order("updated_at", { ascending: false }).limit(8),
    ]);
    setList(((r.data as R[]) || []).map((x) => ({ ...x, content: repairResume(x.content) })));
    setRoles(((t.data as RoleRow[]) || []).filter((x) => x.active));
    setApps((a.data as AppLite[]) || []);
    setCopies((c.data as R[]) || []);
  }, [userId]);
  useEffect(() => {
    if (userId) {
      load();
      loadReady();
    }
  }, [userId, load, loadReady]);

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
    setToast(d.roles ? `Resume imported. Your earlier version is saved in Version history. Rewriting your ${d.roles} role resumes now — about a minute.` : "Resume imported. Your earlier version is saved in Version history.");
    load();
    loadReady();
    if (d.roles) setTimeout(() => (load(), loadReady()), 45000);
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
    loadReady();
    if (d.roles) setTimeout(() => (load(), loadReady()), 45000);
  }
  async function writeRole(roleId: string) {
    setBusy(roleId);
    const r = await fetch("/api/resume/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleId }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't write that resume.");
    setToast(d.ai ? "Rewritten from your master resume." : "Rewritten. Connect an AI key for recruiter-grade writing.");
    load();
    loadReady();
  }
  async function rebuild() {
    setMore(false);
    setBusy("rebuild");
    const r = await fetch("/api/resume/rebuild", { method: "POST" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error" };
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't rebuild.");
    setToast(`Rewriting your ${d.roles} role resumes from your master — about a minute.`);
    setTimeout(() => (load(), loadReady()), 60000);
  }
  async function restore(versionId: string) {
    if (!master) return;
    setBusy(`v:${versionId}`);
    const r = await fetch(`/api/resume/${master.id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }) }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return setToast("Couldn't restore that version.");
    setToast("Restored. The version you replaced is kept in Version history.");
    load();
    loadReady();
  }
  async function setStyle(id: string, style: ResumeStyle) {
    await supabaseBrowser().from("resumes").update({ style }).eq("id", id);
    setList((l) => l?.map((r) => (r.id === id ? { ...r, style } : r)) || null);
  }

  const c = master?.content;
  const fixCount = master ? checkResume(master.content, profile?.full_name || undefined).length : 0;
  const expBullets = c ? (c.experience || []).reduce((n, e) => n + (e.bullets?.length || 0), 0) : 0;
  const templates: ResumeStyle[] = master && !TEMPLATES.includes((master.style || "classic") as ResumeStyle) ? [...TEMPLATES, master.style as ResumeStyle] : TEMPLATES;
  const foundRoles = ready?.roles.filter((r) => r.found).length || 0;
  const weakRole = ready?.roles.find((r) => !r.found && r.missing.length);

  return (
    <>
      <PageHeader
        title="Resumes"
        subtitle="Your real experience, checked the way recruiters screen: what the ATS reads, whether you show up when a recruiter searches, and whether every line holds up in the interview."
        actions={master ? <>
          <button className="btn-secondary" onClick={() => setPaste("")}><ClipboardPaste size={16} /> Paste text</button>
          <button className="btn-primary" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>{busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />} Upload resume</button>
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

      {master && c && (
        <>
          <section aria-label="Readiness" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Check href={`/app/resumes/${master.id}/check`} label="ATS reads it" good={ready ? ready.parse.ok === ready.parse.total : null}
              value={ready ? (ready.parse.ok === ready.parse.total ? `All ${ready.parse.total} fields` : `${ready.parse.ok} of ${ready.parse.total} fields`) : null}
              sub={ready ? (ready.parse.bad.length ? `Read wrong: ${ready.parse.bad.join(", ")}.` : "Name, contact, every job title, employer, date range and degree come out right when the file is read back.") : ""} />
            <Check href={`/app/resumes/${master.id}/check`} label="Recruiter search" good={ready ? foundRoles === ready.roles.length && ready.roles.length > 0 : null}
              value={ready ? (ready.roles.length ? `Found for ${foundRoles} of ${ready.roles.length} roles` : "Add a target role") : null}
              sub={ready ? (weakRole ? `${weakRole.title}: no "${weakRole.missing[0].skill}", which ${weakRole.missing[0].share}% of ${weakRole.postings} recent postings ask for.` : ready.roles.length ? "Your titles and skills match what recruiters search for each role." : "") : ""} />
            <Check href={`/app/resumes/${master.id}/check?tab=lines`} label="Bullets with a result" good={ready ? ready.lines.strong >= ready.lines.total * 0.6 : null}
              value={ready ? `${ready.lines.strong} of ${ready.lines.total}` : null}
              sub={ready ? (ready.lines.total - ready.lines.strong ? `${ready.lines.total - ready.lines.strong} lines say what you did, not what changed because of it.` : "Every line shows an outcome or scope.") : ""} />
            <Check href={`/app/resumes/${master.id}/interview`} label="Interview-ready" good={ready?.stories ? ready.stories.ready >= ready.stories.total * 0.75 : ready ? false : null}
              value={ready ? (ready.stories ? `${ready.stories.ready} of ${ready.stories.total} stories` : "Not started") : null}
              sub={ready ? (ready.stories ? "Stories behind your strongest lines, ready to tell in two minutes." : "Turn your strongest lines into interview stories before you apply.") : ""} />
          </section>

          <section aria-label="Master resume" className="card mb-6 grid overflow-hidden lg:grid-cols-[320px_1fr]"
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}>
            <Link href={`/app/resumes/${master.id}`} className={`flex justify-center bg-canvas p-6 transition ${drag ? "bg-brand-soft" : ""}`} aria-label="Open master resume">
              <Thumb r={master} />
            </Link>
            <div className="flex min-w-0 flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master resume · source of truth</p>
                  <h2 className="mt-1 text-xl font-bold">{titleCase(c.name || "Your resume")}</h2>
                  <p className="text-sm text-muted">{[`${expBullets} experience bullets`, c.projects?.length ? `${c.projects.length} projects` : "", c.certifications?.length ? `${c.certifications.length} certifications` : "", `updated ${timeAgo(master.updated_at)}`].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/app/resumes/${master.id}`} className="btn-secondary min-h-10 text-[13px]"><PenLine size={15} /> Edit</Link>
                  <a href={`/api/resume/${master.id}/pdf`} className="btn-secondary min-h-10 text-[13px]"><Download size={15} /> PDF</a>
                  <a href={`/api/resume/${master.id}/pdf?format=docx`} className="btn-secondary min-h-10 text-[13px]"><Download size={15} /> Word</a>
                  <div className="relative">
                    <button className="btn-ghost min-h-10 px-2.5" aria-label="More actions" aria-expanded={more} onClick={() => setMore((v) => !v)}><MoreHorizontal size={18} /></button>
                    {more && (
                      <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
                        <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas" disabled={busy === "rebuild"} onClick={rebuild}><RefreshCw size={15} /> Rewrite every role resume from this master</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {(ready?.fixes.length || fixCount > 0) ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Fix before you apply <span className="text-orange-ink">· {(ready?.fixes.length || 0) + (fixCount ? 1 : 0)}</span></p>
                  {fixCount > 0 && (
                    <Link href={`/app/resumes/${master.id}#r-check`} className="flex items-start gap-3 rounded-xl border border-[#fde3c8] bg-[#fff7ef] px-3 py-2.5 text-sm hover:underline">
                      <span className="chip shrink-0 bg-orange-tint text-orange-ink">Layout</span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold">{fixCount} entr{fixCount > 1 ? "ies look" : "y looks"} broken to an ATS</span><span className="text-ink-2">Missing dates, a split title or a stray link. Open to fix in one click.</span></span>
                      <ArrowRight size={14} className="mt-1 shrink-0" aria-hidden />
                    </Link>
                  )}
                  {ready?.fixes.map((f) => (
                    <Link key={f.text} href={`/app/resumes/${master.id}/check?tab=lines`} className="flex items-start gap-3 rounded-xl border border-[#fde3c8] bg-[#fff7ef] px-3 py-2.5 text-sm hover:underline">
                      <span className="chip shrink-0 bg-orange-tint text-orange-ink">{f.tags[0] === "No result" ? "Result" : f.tags[0] || "Line"}</span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold">{f.role}: “{f.text.length > 70 ? `${f.text.slice(0, 68)}…` : f.text}”</span><span className="text-ink-2">{f.tip}</span></span>
                      <ArrowRight size={14} className="mt-1 shrink-0" aria-hidden />
                    </Link>
                  ))}
                </div>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted">Template</span>
                  <div role="group" aria-label="Template" className="flex overflow-hidden rounded-lg border border-line">
                    {templates.map((s, i) => {
                      const on = (master.style || "classic") === s;
                      return (
                        <button key={s} title={RESUME_STYLES[s].blurb} aria-pressed={on} onClick={() => setStyle(master.id, s)} className={`h-9 px-3 text-[13px] ${i ? "border-l border-line" : ""} ${on ? "bg-brand-tint font-semibold text-brand-ink" : "bg-white text-ink-2 hover:bg-canvas"}`}>
                          {RESUME_STYLES[s].label}{s === "classic" ? " · recommended" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <details className="ml-auto text-[13px] text-ink-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 font-semibold"><History size={14} aria-hidden /> Version history{ready?.versions.length ? ` · ${ready.versions.length}` : ""}</summary>
                  <div className="mt-2 space-y-1.5">
                    {!ready?.versions.length && <p className="text-muted">Every upload, edit and rewrite keeps the version it replaced. Nothing saved yet.</p>}
                    {ready?.versions.map((v) => (
                      <div key={v.id} className="flex items-center gap-3">
                        <span>{new Date(v.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        <button className="font-semibold text-brand-ink hover:underline" disabled={busy === `v:${v.id}`} onClick={() => restore(v.id)}>{busy === `v:${v.id}` ? "Restoring…" : "Restore"}</button>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </section>

          <section aria-label="Target roles" className="card mb-6 overflow-hidden py-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-5">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">One resume per target role</h2>
                <p className="text-sm text-muted">Search match counts the skills recruiters filter on, from open postings in your job feed. Every job you apply to still gets its own tailored copy.</p>
              </div>
              <Link href="/app/targets" className="btn-ghost min-h-9 text-[13px]"><Target size={15} /> Manage roles</Link>
            </div>
            {roles.length === 0 ? (
              <div className="px-5"><EmptyState title="Add a target role" body="Each role you target gets one focused resume." action={<Link href="/app/targets" className="btn-primary">Add a role</Link>} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th scope="col" className="border-b border-line-2 px-5 py-2.5 font-semibold">Role</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Fit</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Search match</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Missing skill recruiters ask for</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Sent → replies → interviews</th>
                      <th scope="col" className="border-b border-line-2 px-5 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => {
                      const r = list?.find((x) => !x.is_master && x.target_role_id === role.id && (x.kind || "role") === "role");
                      const fit = role.coach?.fit;
                      const rd = ready?.roles.find((x) => x.id === role.id);
                      const sent = apps.filter((a) => a.target_role_id === role.id && SENT(a.status));
                      const coached = Boolean(role.coach?.answers?.some((x) => x.a.trim()));
                      return (
                        <tr key={role.id} className="align-top">
                          <td className="border-b border-line-2 px-5 py-3.5">
                            <p className="font-semibold">{titleCase(role.title)}</p>
                            <p className="text-xs text-muted">{r ? `Rewritten ${timeAgo(r.updated_at)}` : "Not written yet"}</p>
                          </td>
                          <td className="border-b border-line-2 px-3 py-3.5">
                            {fit ? <span className={`chip ${FIT[fit.level].cls}`}>{FIT[fit.level].label}</span> : <span className="chip bg-[#eef0f4] text-muted"><Loader2 size={12} className="animate-spin" /> Checking</span>}
                            {fit && fit.level !== "strong" && (
                              <button className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-pink-ink hover:underline" onClick={() => setCoachFor(role)}><MessageSquareText size={12} /> {coached ? "Update what you know" : "Tell us what you know"}</button>
                            )}
                          </td>
                          <td className="border-b border-line-2 px-3 py-3.5">
                            {rd ? (rd.postings ? <><p className="font-semibold">{rd.have} of {rd.skills} skills</p><p className="text-xs text-muted">{rd.postings} recent postings{rd.titleFound ? "" : " · title not found"}</p></> : <p className="text-xs text-muted">No open postings in your feed yet</p>) : <span className="skeleton block h-8 w-28" />}
                          </td>
                          <td className="border-b border-line-2 px-3 py-3.5 text-ink-2">
                            {rd ? (rd.missing.length ? rd.missing.map((m) => `${m.skill} (${m.share}%)`).join(", ") : <span className="text-green-ink">None in the top {rd.skills}</span>) : <span className="skeleton block h-5 w-36" />}
                          </td>
                          <td className="border-b border-line-2 px-3 py-3.5 tabular-nums">{sent.length} → {sent.filter((a) => REPLIED(a.status)).length} → {sent.filter((a) => INTERVIEW(a.status)).length}</td>
                          <td className="whitespace-nowrap border-b border-line-2 px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {r ? <>
                                <Link href={`/app/resumes/${r.id}/check?role=${role.id}`} className="btn-ghost min-h-9 px-2.5 text-[13px]"><Search size={14} /> Check</Link>
                                <Link href={`/app/resumes/${r.id}/interview?role=${role.id}`} className="btn-ghost min-h-9 px-2.5 text-[13px]">Interview kit</Link>
                                <Link href={`/app/resumes/${r.id}`} className="btn-secondary min-h-9 px-3 text-[13px]">Open</Link>
                                <a href={`/api/resume/${r.id}/pdf`} className="rounded-lg p-2 text-subtle hover:bg-canvas" aria-label={`Download ${role.title} resume PDF`}><Download size={16} /></a>
                              </> : null}
                              <button className="btn-ghost min-h-9 px-2.5 text-[13px]" disabled={busy === role.id} onClick={() => writeRole(role.id)} aria-label={r ? `Rewrite ${role.title} resume` : `Write ${role.title} resume`}>
                                {busy === role.id ? <Loader2 size={14} className="animate-spin" /> : r ? <RefreshCw size={14} /> : <><Sparkles size={14} /> Write it</>}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Sent with applications" className="card mb-6 overflow-hidden py-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-5">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">Sent with applications</h2>
                <p className="text-sm text-muted">The exact resume each employer received. Open it before an interview to see what they read.</p>
              </div>
              <Link href="/app/applications" className="btn-ghost min-h-9 text-[13px]">All applications <ArrowRight size={14} /></Link>
            </div>
            {copies.length === 0 ? (
              <p className="px-5 text-sm text-muted">Nothing sent yet. When you apply, the tailored copy shows up here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th scope="col" className="border-b border-line-2 px-5 py-2.5 font-semibold">Job</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Built for</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Made</th>
                      <th scope="col" className="border-b border-line-2 px-3 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="border-b border-line-2 px-5 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {copies.map((x) => {
                      const [title, company] = (x.name || "").split(" — ");
                      const app = apps.find((a) => a.resume_id === x.id);
                      return (
                        <tr key={x.id}>
                          <td className="border-b border-line-2 px-5 py-3"><p className="font-semibold">{title}</p>{company && <p className="text-xs text-muted">{company}</p>}</td>
                          <td className="border-b border-line-2 px-3 py-3 text-ink-2">{roles.find((r) => r.id === x.target_role_id)?.title || "—"}</td>
                          <td className="border-b border-line-2 px-3 py-3 text-ink-2">{timeAgo(x.updated_at)}</td>
                          <td className="border-b border-line-2 px-3 py-3"><span className="chip bg-[#eef0f4] text-ink-2">{app ? app.status.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase()) : "Prepared"}</span></td>
                          <td className="whitespace-nowrap border-b border-line-2 px-5 py-3 text-right">
                            <Link href={`/app/resumes/${x.id}/interview`} className="btn-ghost min-h-9 px-2.5 text-[13px]">Interview kit</Link>
                            <a href={`/api/resume/${x.id}/pdf`} className="btn-ghost min-h-9 px-2.5 text-[13px]"><FileText size={14} /> Resume</a>
                            <a href={`/api/resume/${x.id}/pdf?kind=cover`} className="btn-ghost min-h-9 px-2.5 text-[13px]">Letter</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
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

      {coachFor && <RoleCoach role={coachFor} onClose={() => setCoachFor(null)} onDone={(msg) => { setCoachFor(null); setToast(msg); load(); loadReady(); }} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

const titleCase = (t: string) => (t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : t);

function Check({ href, label, value, sub, good }: { href: string; label: string; value: string | null; sub: string; good: boolean | null }) {
  return (
    <Link href={href} className="card flex flex-col gap-1.5 p-4 hover:border-[#c9d5fb]">
      <span className="flex items-center gap-2">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${good === null ? "bg-line" : good ? "bg-green" : "bg-orange"}`} />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      </span>
      {value === null ? <span className="skeleton h-7 w-32" /> : <span className="text-xl font-bold">{value}</span>}
      {value === null ? <span className="skeleton h-4 w-full" /> : <span className="text-[13px] text-ink-2">{sub}</span>}
    </Link>
  );
}

/** The real resume layout, scaled down: the same component the editor previews, so it never disagrees with the PDF. */
function Thumb({ r }: { r: R }) {
  return (
    <div className="relative h-[330px] w-[255px] overflow-hidden rounded-[3px] bg-white shadow-[0_10px_30px_rgba(16,24,40,.12)]">
      <div className="pointer-events-none absolute left-0 top-0 w-[760px] origin-top-left" style={{ transform: "scale(0.3355)" }} aria-hidden>
        <ResumePaper c={r.content} style={(r.style || "classic") as ResumeStyle} />
      </div>
    </div>
  );
}
