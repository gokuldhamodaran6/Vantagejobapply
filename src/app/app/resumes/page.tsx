"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import type { Resume } from "@/lib/types";
import { hardNavigate } from "@/lib/nav";

export default function ResumesPage() {
  const { roles, userId, profile } = useMe();
  const [list, setList] = useState<Resume[] | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const { data } = await supabaseBrowser().from("resumes").select("*").order("is_master", { ascending: false }).order("updated_at", { ascending: false });
    setList((data as Resume[]) || []);
  }
  useEffect(() => {
    if (userId) load();
  }, [userId]);

  async function importResume() {
    setBusy(true);
    const r = await fetch("/api/resume/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setToast(d.error);
    setPaste("");
    setToast("Resume imported. Review it and fix anything we misread.");
    load();
  }

  async function createForRole(roleId: string, title: string) {
    const master = list?.find((r) => r.is_master);
    const { data, error } = await supabaseBrowser().from("resumes").insert({
      user_id: userId, target_role_id: roleId, name: `${title} resume`, content: master?.content || { name: profile?.full_name || "", email: profile?.email },
    }).select("id").single();
    if (error) return setToast(error.message);
    hardNavigate(`/app/resumes/${data.id}`);
  }

  const master = list?.find((r) => r.is_master);
  const roleResumes = list?.filter((r) => !r.is_master && r.target_role_id && !r.name.includes(" — ")) || [];
  const jobResumes = list?.filter((r) => !r.is_master && r.name.includes(" — ")) || [];

  return (
    <>
      <PageHeader title="Resumes" subtitle="One master resume, one per target role, and a tailored copy for every job you apply to." />

      {list && !master && (
        <section className="card mb-6 p-5 sm:p-6">
          <h2 className="text-lg font-bold">Add your resume</h2>
          <p className="mt-1 text-sm text-muted">Paste the text of your current resume. We turn it into a clean, ATS-ready master resume you can edit.</p>
          <textarea rows={10} className="input mt-4 py-3 text-sm leading-relaxed" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste your resume here" aria-label="Resume text" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || paste.trim().length < 40} onClick={importResume}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Import resume</button>
            <button className="btn-secondary" onClick={async () => {
              const { data } = await supabaseBrowser().from("resumes").insert({ user_id: userId, name: "Master resume", is_master: true, content: { name: profile?.full_name || "", email: profile?.email } }).select("id").single();
              if (data) hardNavigate(`/app/resumes/${data.id}`);
            }}>Start from scratch</button>
          </div>
        </section>
      )}

      {list === null && <div className="skeleton h-60" />}

      {master && (
        <section className="mb-6">
          <h2 className="mb-3 font-semibold">Master resume</h2>
          <ResumeRow r={master} label="All your verified experience" />
        </section>
      )}

      {master && (
        <section className="mb-6">
          <h2 className="mb-3 font-semibold">By target role</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {roles.map((role) => {
              const r = roleResumes.find((x) => x.target_role_id === role.id);
              return r ? (
                <ResumeRow key={role.id} r={r} label={role.title} />
              ) : (
                <button key={role.id} onClick={() => createForRole(role.id, role.title)} className="card flex items-center gap-3 border-dashed p-4 text-left hover:border-brand">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-tint text-brand"><Plus size={18} /></span>
                  <span><span className="block font-semibold">Create {role.title} resume</span><span className="block text-sm text-muted">Starts from your master resume</span></span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {jobResumes.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Tailored for specific jobs</h2>
          <div className="grid gap-3 md:grid-cols-2">{jobResumes.map((r) => <ResumeRow key={r.id} r={r} label="Tailored copy" />)}</div>
        </section>
      )}

      {list && list.length === 0 && !paste && null}
      {list && master && roles.length === 0 && <EmptyState title="Add target roles" body="Each target role gets its own resume." action={<Link href="/app/targets" className="btn-primary">Add a role</Link>} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

function ResumeRow({ r, label }: { r: Resume; label: string }) {
  return (
    <Link href={`/app/resumes/${r.id}`} className="card flex items-center gap-4 p-4 hover:border-[#c9d5fb]">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-tint text-brand"><FileText size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.name}</span>
        <span className="block text-sm text-muted">{label} · edited {timeAgo(r.updated_at)}</span>
      </span>
      {r.ats_score != null && <span className={`pill ${r.ats_score >= 80 ? "bg-green-tint text-green-ink" : r.ats_score >= 60 ? "bg-brand-tint text-brand-ink" : "bg-orange-tint text-orange-ink"}`}>ATS {r.ats_score}</span>}
    </Link>
  );
}
