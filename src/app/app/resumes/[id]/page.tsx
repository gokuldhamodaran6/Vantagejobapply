"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Plus, Trash2 } from "lucide-react";
import { ResumePaper } from "@/components/resume-paper";
import { Toast } from "@/components/ui";
import { useMe } from "@/lib/me";
import { supabaseBrowser } from "@/lib/supabase/client";
import { extractKeywords, resumeText, scoreResume } from "@/lib/ats";
import type { Resume, ResumeContent } from "@/lib/types";

export default function ResumeEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { roles } = useMe();
  const [r, setR] = useState<Resume | null>(null);
  const [c, setC] = useState<ResumeContent | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [showKw, setShowKw] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    supabaseBrowser().from("resumes").select("*").eq("id", id).single().then(({ data }) => {
      if (data) {
        setR(data as Resume);
        setC((data as Resume).content);
      }
    });
  }, [id]);

  // Keywords most often asked for in live jobs for this resume's target role.
  useEffect(() => {
    const role = roles.find((x) => x.id === r?.target_role_id) || roles[0];
    if (!role) return;
    supabaseBrowser()
      .from("jobs")
      .select("title,description")
      .textSearch("fts", role.title, { type: "websearch", config: "english" })
      .limit(25)
      .then(({ data }) => {
        const text = (data || []).map((j: { title: string; description: string | null }) => `${j.title} ${j.description || ""}`).join(" \n ");
        const kw = extractKeywords(`${text} ${role.keywords.join(" ")}`, 18);
        setKeywords([...new Set([...role.keywords.map((k) => k.toLowerCase()), ...kw])].slice(0, 20));
      });
  }, [r, roles]);

  const report = useMemo(() => (c ? scoreResume(c, keywords) : null), [c, keywords]);

  if (!r || !c) return <div className="skeleton h-[600px]" />;

  const up = (patch: Partial<ResumeContent>) => {
    setC({ ...c, ...patch });
    setDirty(true);
  };

  async function save() {
    const { error } = await supabaseBrowser().from("resumes").update({ content: c, ats_score: report?.score ?? null, name: r!.name }).eq("id", r!.id);
    setToast(error ? error.message : "Resume saved");
    if (!error) setDirty(false);
  }

  function printPdf() {
    // Print the resume alone in a clean window (choose "Save as PDF" in the print dialog).
    const paper = document.querySelector(".resume-paper");
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!paper || !w) return setToast("Allow pop-ups to download your PDF.");
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join("");
    w.document.write(`<!doctype html><html><head><title>${(c!.name || "Resume").replace(/</g, "")}</title>${styles}<style>@page{margin:12mm}body{background:#fff}.resume-paper{max-width:none!important;padding:0!important}</style></head><body>${paper.outerHTML.replace(/<mark[^>]*>|<\/mark>/g, "")}</body></html>`);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 400);
  }

  function downloadTxt() {
    const blob = new Blob([resumeText(c!).replace(/ \n /g, "\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(c!.name || "resume").replace(/\s+/g, "_")}.txt`;
    a.click();
  }

  return (
    <>
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <Link href="/app/resumes" className="btn-ghost"><ArrowLeft size={16} /> Resumes</Link>
        <input aria-label="Resume name" className="input max-w-xs font-semibold" value={r.name} onChange={(e) => { setR({ ...r, name: e.target.value }); setDirty(true); }} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={downloadTxt}>Plain text</button>
          <button className="btn-secondary" onClick={printPdf}><Download size={16} /> Download PDF</button>
          <button className="btn-primary" onClick={save} disabled={!dirty}>{dirty ? "Save" : "Saved"}</button>
        </div>
      </div>

      <div className="no-print mb-4 flex rounded-lg bg-[#eef0f4] p-1 lg:hidden" role="tablist">
        {(["edit", "preview"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-9 flex-1 rounded-md text-sm font-semibold capitalize ${tab === t ? "bg-white shadow-sm" : "text-muted"}`}>{t}</button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr]">
        <div className={`no-print space-y-5 ${tab === "preview" ? "hidden lg:block" : ""}`}>
          {report && (
            <section className="card p-5">
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 shrink-0 rounded-full" style={{ background: `conic-gradient(#2f5beb 0 ${report.score}%, #e6e8ef ${report.score}% 100%)` }}>
                  <span className="absolute inset-[7px] flex items-center justify-center rounded-full bg-white text-lg font-bold">{report.score}</span>
                </div>
                <div>
                  <p className="font-semibold">ATS score</p>
                  <p className="text-sm text-muted">Structure plus keywords from live {roles.find((x) => x.id === r.target_role_id)?.title || "target"} jobs</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {report.checks.map((ck) => (
                  <li key={ck.title} className="flex gap-2.5">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ck.ok ? "bg-green-tint text-green-ink" : "bg-orange-tint text-orange-ink"}`}>{ck.ok ? "✓" : "!"}</span>
                    <span><span className="font-semibold">{ck.title}</span> — <span className="text-muted">{ck.detail}</span></span>
                  </li>
                ))}
              </ul>
              {report.missing.length > 0 && (
                <p className="mt-4 text-sm text-muted">Often asked for but not in your resume — add only if true: <span className="font-medium text-ink-2">{report.missing.slice(0, 10).join(", ")}</span></p>
              )}
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={showKw} onChange={(e) => setShowKw(e.target.checked)} /> Highlight matched keywords in preview</label>
            </section>
          )}

          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Contact</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" aria-label="Full name" placeholder="Full name" value={c.name || ""} onChange={(e) => up({ name: e.target.value })} />
              <input className="input" aria-label="Headline" placeholder="Headline, e.g. Data Analyst" value={c.headline || ""} onChange={(e) => up({ headline: e.target.value })} />
              <input className="input" aria-label="Email" placeholder="Email" value={c.email || ""} onChange={(e) => up({ email: e.target.value })} />
              <input className="input" aria-label="Phone" placeholder="Phone" value={c.phone || ""} onChange={(e) => up({ phone: e.target.value })} />
              <input className="input" aria-label="City" placeholder="City, Country" value={c.location || ""} onChange={(e) => up({ location: e.target.value })} />
              <input className="input" aria-label="Links" placeholder="LinkedIn / GitHub (comma separated)" value={(c.links || []).join(", ")} onChange={(e) => up({ links: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </section>

          <section className="card space-y-2 p-5">
            <h2 className="font-semibold">Summary</h2>
            <textarea className="input py-2.5 text-sm" rows={4} aria-label="Summary" value={c.summary || ""} onChange={(e) => up({ summary: e.target.value })} placeholder="2–3 sentences: who you are, years of experience, what you're best at." />
          </section>

          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Skills</h2><button className="btn-ghost min-h-8 text-xs" onClick={() => up({ skills: [...(c.skills || []), { group: "Tools", items: [] }] })}><Plus size={14} /> Group</button></div>
            {(c.skills || []).map((g, i) => (
              <div key={i} className="flex gap-2">
                <input className="input w-36" aria-label="Skill group" value={g.group} onChange={(e) => up({ skills: c.skills!.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)) })} />
                <input className="input" aria-label="Skills" value={g.items.join(", ")} onChange={(e) => up({ skills: c.skills!.map((x, j) => (j === i ? { ...x, items: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)) })} />
                <button className="rounded-lg p-2 text-subtle hover:text-red-ink" aria-label="Remove group" onClick={() => up({ skills: c.skills!.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
              </div>
            ))}
          </section>

          <section className="card space-y-4 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Experience</h2><button className="btn-ghost min-h-8 text-xs" onClick={() => up({ experience: [{ title: "", company: "", bullets: [""] }, ...(c.experience || [])] })}><Plus size={14} /> Role</button></div>
            {(c.experience || []).map((e, i) => {
              const set = (patch: Partial<typeof e>) => up({ experience: c.experience!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="rounded-xl border border-line p-3.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input" aria-label="Job title" placeholder="Job title" value={e.title} onChange={(ev) => set({ title: ev.target.value })} />
                    <input className="input" aria-label="Company" placeholder="Company" value={e.company} onChange={(ev) => set({ company: ev.target.value })} />
                    <input className="input" aria-label="Start" placeholder="Start (MM/YYYY)" value={e.start || ""} onChange={(ev) => set({ start: ev.target.value })} />
                    <input className="input" aria-label="End" placeholder="End (MM/YYYY or Present)" value={e.end || ""} onChange={(ev) => set({ end: ev.target.value })} />
                  </div>
                  <p className="mt-3 text-xs text-muted">One achievement per line: action, what you did, measurable result.</p>
                  <textarea className="input mt-1 py-2 text-sm" rows={Math.max(3, e.bullets.length + 1)} aria-label="Bullets" value={e.bullets.join("\n")} onChange={(ev) => set({ bullets: ev.target.value.split("\n") })} />
                  <button className="mt-2 text-xs font-medium text-muted hover:text-red-ink" onClick={() => up({ experience: c.experience!.filter((_, j) => j !== i) })}>Remove role</button>
                </div>
              );
            })}
          </section>

          <section className="card space-y-4 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Projects</h2><button className="btn-ghost min-h-8 text-xs" onClick={() => up({ projects: [...(c.projects || []), { name: "", bullets: [""] }] })}><Plus size={14} /> Project</button></div>
            {(c.projects || []).map((p, i) => (
              <div key={i} className="rounded-xl border border-line p-3.5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="input" aria-label="Project name" placeholder="Project name" value={p.name} onChange={(e) => up({ projects: c.projects!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="input" aria-label="Tech" placeholder="Tools used" value={p.tech || ""} onChange={(e) => up({ projects: c.projects!.map((x, j) => (j === i ? { ...x, tech: e.target.value } : x)) })} />
                </div>
                <textarea className="input mt-2 py-2 text-sm" rows={3} aria-label="Project bullets" value={p.bullets.join("\n")} onChange={(e) => up({ projects: c.projects!.map((x, j) => (j === i ? { ...x, bullets: e.target.value.split("\n") } : x)) })} />
              </div>
            ))}
          </section>

          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Education</h2><button className="btn-ghost min-h-8 text-xs" onClick={() => up({ education: [...(c.education || []), { degree: "", school: "" }] })}><Plus size={14} /> Degree</button></div>
            {(c.education || []).map((e, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_110px]">
                <input className="input" aria-label="Degree" placeholder="Degree" value={e.degree} onChange={(ev) => up({ education: c.education!.map((x, j) => (j === i ? { ...x, degree: ev.target.value } : x)) })} />
                <input className="input" aria-label="School" placeholder="School" value={e.school} onChange={(ev) => up({ education: c.education!.map((x, j) => (j === i ? { ...x, school: ev.target.value } : x)) })} />
                <input className="input" aria-label="Year" placeholder="MM/YYYY" value={e.end || ""} onChange={(ev) => up({ education: c.education!.map((x, j) => (j === i ? { ...x, end: ev.target.value } : x)) })} />
              </div>
            ))}
            <label className="block text-sm font-semibold">Certifications (comma separated)
              <input className="input mt-1.5" value={(c.certifications || []).join(", ")} onChange={(e) => up({ certifications: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </label>
          </section>
        </div>

        <div className={tab === "edit" ? "hidden lg:block" : ""}>
          <div className="sticky top-6 overflow-hidden rounded-xl border border-line bg-[#e9ebf0] p-3 sm:p-5">
            <div className="max-h-[calc(100vh-120px)] overflow-y-auto shadow-lg">
              <ResumePaper c={{ ...c, experience: c.experience?.map((e) => ({ ...e, bullets: e.bullets.filter((b) => b.trim()) })) }} highlight={showKw ? report?.matched || [] : []} />
            </div>
          </div>
        </div>
      </div>
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}
