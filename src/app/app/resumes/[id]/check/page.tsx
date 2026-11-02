"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check as Tick, Loader2, X } from "lucide-react";
import { ResumePaper } from "@/components/resume-paper";
import type { ParseRow, SkillProof, LineGrade, Knockout } from "@/lib/resume/recruiter";
import type { ResumeContent, ResumeStyle } from "@/lib/types";

type Data = {
  resume: { id: string; name: string; style: string; isMaster: boolean; content: ResumeContent };
  target: { kind: "role" | "job"; id: string; label: string; postings: number };
  roles: { id: string; title: string }[];
  parse: ParseRow[];
  title: { found: boolean; via: string };
  skills: SkillProof[];
  lines: LineGrade[];
  knockouts: Knockout[];
};
type Tab = "parse" | "search" | "lines" | "knock";
const TABS: [Tab, string][] = [["parse", "What the ATS reads"], ["search", "Search match"], ["lines", "Line by line"], ["knock", "Knockouts"]];
const QTY = /\d[\d,.]*\s?%\+?|\d[\d,.]*\+|\$\s?\d[\d,.]*\s?[kmb]?/gi;

export default function RecruiterCheck({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tab = (sp.get("tab") as Tab) || "parse";
  const q = sp.get("job") ? `job=${sp.get("job")}` : sp.get("role") ? `role=${sp.get("role")}` : "";

  useEffect(() => {
    setD(null);
    fetch(`/api/resume/${id}/check${q ? `?${q}` : ""}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || "Couldn't run the check.");
      else setD(j);
    });
  }, [id, q]);

  const go = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set(k, v);
    if (k === "role") n.delete("job");
    router.replace(`?${n.toString()}`, { scroll: false });
  };

  const marks = useMemo(() => {
    if (!d) return [];
    const c = d.resume.content;
    const text = [c.summary, ...(c.experience || []).flatMap((e) => e.bullets)].join(" ");
    return [...new Set(text.match(QTY) || [])].filter((x) => x.length > 1).slice(0, 30);
  }, [d]);

  if (err) return <div className="card p-6"><p className="font-semibold">{err}</p><Link href="/app/resumes" className="mt-3 inline-block font-semibold text-brand-ink">← Resumes</Link></div>;

  const strong = d?.lines.filter((l) => l.grade === "strong").length || 0;
  const firstRole = d?.resume.content.experience?.find((e) => !e.brief);
  const firstWeak = d && firstRole ? !d.lines.some((l) => l.section === "experience" && l.index === 0 && l.grade === "strong") : false;

  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/app/resumes" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink"><ArrowLeft size={14} /> Resumes</Link>
          <h1 className="mt-1.5 text-2xl font-bold">Recruiter check{d ? ` · ${d.resume.isMaster ? "Master resume" : d.resume.name}` : ""}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Three things decide whether you get a call: the ATS reads you right, you show up in the recruiter&apos;s search, and the six-second skim lands. No made-up score: every check says exactly what it found.</p>
        </div>
        {d && d.roles.length > 0 && (
          <label className="flex min-w-[260px] flex-col gap-1 text-xs font-semibold text-muted">
            Check against
            <select className="input h-11 py-0 text-sm font-medium text-ink" value={d.target.kind === "role" ? d.target.id : ""} onChange={(e) => go("role", e.target.value)}>
              {d.target.kind === "job" && <option value="">{d.target.label}</option>}
              {d.roles.map((r) => <option key={r.id} value={r.id}>{r.title} · open postings</option>)}
            </select>
          </label>
        )}
      </div>

      {!d ? (
        <div className="grid gap-5 lg:grid-cols-[480px_1fr]"><div className="skeleton h-[620px]" /><div className="skeleton h-[620px]" /></div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[480px_1fr]">
          <section aria-label="Six-second skim" className="space-y-2.5">
            <p className="text-sm"><span className="font-semibold">What a recruiter sees in six seconds.</span> <span className="text-muted">Eyes land on titles, employers, dates and <mark className="rounded bg-[#dce7ff] px-1">numbers</mark>.</span></p>
            <div className="relative overflow-hidden rounded-[4px] shadow-[0_10px_30px_rgba(16,24,40,.12)]" style={{ height: 620 }}>
              <div className="absolute left-0 top-0 w-[760px] origin-top-left" style={{ transform: "scale(0.6316)" }}>
                <ResumePaper c={d.resume.content} style={(d.resume.style || "classic") as ResumeStyle} highlight={marks} />
              </div>
            </div>
            <p className="text-[13px] text-ink-2">
              <b>Skim verdict:</b> {strong} of {d.lines.length} lines show a result or scope.{" "}
              {firstWeak && firstRole ? `Your first role (${firstRole.title}) has no result in its bullets, so the first thing under Experience is your weakest. Add one number there.` : "Your first role opens with a result. Good."}
            </p>
          </section>

          <section className="card overflow-hidden">
            <div role="tablist" aria-label="Checks" className="flex flex-wrap border-b border-line-2 px-3">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => go("tab", k)} className={`min-h-12 border-b-2 px-3.5 text-sm font-semibold ${tab === k ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
              ))}
            </div>

            {tab === "parse" && (
              <div className="space-y-3 p-5">
                <p className="text-sm text-ink-2">We render your resume exactly as it downloads, read the text back the way Workday, Greenhouse, Lever and iCIMS do, and compare. Recruiters search this text, not your design.</p>
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {d.parse.map((p) => (
                      <tr key={p.field} className="align-top">
                        <th scope="row" className="w-36 border-b border-line-2 py-2.5 pr-3 text-left font-semibold">{p.field}</th>
                        <td className="border-b border-line-2 py-2.5 pr-3 text-ink-2">{p.read}{p.note && <span className="block text-orange-ink">{p.note}</span>}</td>
                        <td className={`whitespace-nowrap border-b border-line-2 py-2.5 text-right font-semibold ${p.ok ? "text-green-ink" : "text-orange-ink"}`}>{p.ok ? <><Tick size={14} className="mr-1 inline" />Read right</> : <><X size={14} className="mr-1 inline" />Check</>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[13px] text-ink-2"><b>Title search:</b> {d.title.found ? `a recruiter searching "${d.target.label.split(" · ")[0]}" finds you through ${d.title.via}.` : `a search for "${d.target.label.split(" · ")[0]}" won't match your titles or headline. If it describes work you've done, say it in your headline; we never rename a title you held.`}</p>
              </div>
            )}

            {tab === "search" && (
              <div className="space-y-3 p-5">
                <p className="text-sm text-ink-2">
                  {d.target.kind === "job" ? "The skills this posting names." : d.target.postings ? `The skills recruiters filter on for ${d.target.label}, ranked by how many of ${d.target.postings} open postings in your job feed ask for them.` : "No open postings for this role in your feed yet, so there's nothing to count."}{" "}
                  <b>Proven</b> means a bullet shows you using it; <b>listed</b> means it&apos;s only in your skills or summary.
                </p>
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="py-2 font-semibold">Skill</th>{d.target.kind === "role" && <th scope="col" className="py-2 font-semibold">Postings</th>}<th scope="col" className="py-2 font-semibold">On your resume</th></tr></thead>
                  <tbody>
                    {d.skills.map((s) => (
                      <tr key={s.skill} className="border-t border-line-2">
                        <td className="py-2.5 pr-3 font-semibold capitalize">{s.skill}</td>
                        {d.target.kind === "role" && <td className="w-48 py-2.5 pr-3"><span className="flex items-center gap-2"><span className="h-1.5 flex-1 rounded-full bg-line-2"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${s.share}%` }} /></span><span className="w-9 text-right text-xs text-ink-2">{s.share}%</span></span></td>}
                        <td className={`py-2.5 font-medium ${s.status === "proven" ? "text-green-ink" : s.status === "listed" ? "text-orange-ink" : "text-pink-ink"}`}>
                          {s.status === "proven" ? `Proven · ${s.where.slice(0, 3).join(", ")}` : s.status === "listed" ? "Listed only · back it with a bullet if true" : "Missing · add only if you've done it"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "lines" && (
              <div className="space-y-3 p-5">
                <p className="text-sm text-ink-2">Every bullet, graded on what hiring managers look for: a result or scope, a clear opening verb, one or two lines. Rewrites only ever use facts you give us.</p>
                {d.lines.map((l) => (
                  <div key={`${l.section}${l.index}-${l.bullet}`} className="rounded-xl border border-line-2 p-3.5">
                    <p className="text-xs text-muted">{l.role}</p>
                    <p className="mt-0.5 text-sm">{l.text}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">{l.tags.map((t) => <span key={t.t} className={`chip ${t.good ? "bg-green-tint text-green-ink" : "bg-orange-tint text-orange-ink"}`}>{t.t}</span>)}</div>
                    <p className="mt-1.5 text-[13px] text-ink-2">{l.tip}</p>
                  </div>
                ))}
                <Link href={`/app/resumes/${d.resume.id}`} className="btn-secondary min-h-10 text-[13px]">Edit these lines</Link>
              </div>
            )}

            {tab === "knock" && (
              <div className="space-y-1 p-5">
                <p className="mb-2 text-sm text-ink-2">Knockout questions remove candidates before anyone reads a resume. Set them once and Vantage answers the same way on every application.</p>
                {d.knockouts.map((k) => (
                  <div key={k.q} className="flex items-start gap-3 border-t border-line-2 py-3">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{k.q}</p><p className="text-[13px] text-ink-2">{k.a}</p></div>
                    <span className={`whitespace-nowrap text-sm font-semibold ${k.set ? "text-green-ink" : "text-orange-ink"}`}>{k.set ? "Set" : "Set it"}</span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-2"><Link href="/app/settings" className="btn-secondary min-h-10 text-[13px]">Work authorization</Link><Link href="/app/targets" className="btn-secondary min-h-10 text-[13px]">Locations and salary</Link></div>
              </div>
            )}
          </section>
        </div>
      )}
      {!d && !err && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Reading your resume the way an ATS does…</p>}
    </div>
  );
}
