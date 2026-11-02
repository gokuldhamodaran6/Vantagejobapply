"use client";
import Link from "next/link";
import { Fragment, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Printer, RefreshCw } from "lucide-react";
import { Toast } from "@/components/ui";
import type { InterviewKit, Story } from "@/lib/resume/interview";

const GROUPS: [string, string][] = [["resume", "From your resume"], ["posting", "For this role"], ["company", "What this employer screens for"], ["behavioral", "Behavioral"]];
const FIELDS: [keyof Story, string][] = [["situation", "Situation"], ["part", "Your part"], ["action", "What you did"], ["result", "Result"]];

export default function InterviewKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const q = sp.get("job") ? `job=${sp.get("job")}` : sp.get("role") ? `role=${sp.get("role")}` : "";
  const [kit, setKit] = useState<InterviewKit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Story | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [outage, setOutage] = useState<string | null>(null);

  async function load(fresh = false) {
    setBusy(fresh ? "fresh" : "load");
    const r = await fetch(`/api/resume/${id}/interview?${q}${fresh ? "&fresh=1" : ""}`).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setErr(d.error || "Couldn't build the interview kit.");
    setKit(d.kit);
    setOutage(d.outage || null);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, q]);

  async function saveStory() {
    if (!edit) return;
    setBusy("save");
    const r = await fetch(`/api/resume/${id}/interview?${q}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) return setToast(d.error || "Couldn't save that story.");
    setKit(d.kit);
    setEdit(null);
    setToast(d.kit.stories.find((s: Story) => s.ref === edit.ref)?.ready ? "Story ready." : "Saved. Fill the [bracketed] parts to make it ready.");
  }

  if (err) return <div className="card p-6"><p className="font-semibold">{err}</p><Link href="/app/resumes" className="mt-3 inline-block font-semibold text-brand-ink">← Resumes</Link></div>;
  const ready = kit?.stories.filter((s) => s.ready).length || 0;

  return (
    <div className="mx-auto max-w-[1240px] print:max-w-none">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/app/resumes" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink print:hidden"><ArrowLeft size={14} /> Resumes</Link>
          <h1 className="mt-1.5 text-2xl font-bold">Interview kit{kit ? ` · ${kit.target}${kit.company ? `, ${kit.company}` : ""}` : ""}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">The resume gets the call; the interview tests every line. Each strong line becomes a story you can tell in two minutes, matched to the questions you&apos;re likely to get. Fill the [bracketed] parts with what only you know.</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button className="btn-secondary min-h-10 text-[13px]" onClick={() => window.print()} disabled={!kit}><Printer size={15} /> Print one-pager</button>
          <button className="btn-ghost min-h-10 text-[13px]" onClick={() => load(true)} disabled={!!busy}>{busy === "fresh" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Rebuild questions</button>
        </div>
      </div>

      {!kit ? (
        <div className="space-y-3"><div className="skeleton h-24" /><div className="grid gap-5 lg:grid-cols-2"><div className="skeleton h-[520px]" /><div className="skeleton h-[520px]" /></div><p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Turning your strongest lines into stories and likely questions. This takes about 30 seconds the first time.</p></div>
      ) : (
        <>
          {outage && (
            <div className="mb-4 rounded-2xl border border-[#fde3c8] bg-[#fff7ef] p-4 text-sm print:hidden">
              <p className="font-semibold">{outage === "billing" ? "The AI writer is out of credits right now." : "The AI writer isn't responding right now."}</p>
              <p className="text-ink-2">So the stories below are blank prompts and there are no questions yet. You can still fill each story in your own words; press Rebuild questions once the writer is back.</p>
            </div>
          )}
          <div className="mb-5 grid gap-3 sm:grid-cols-3 print:hidden">
            <Stat label="Stories ready" value={`${ready} of ${kit.stories.length}`} sub={kit.stories.length - ready ? `${kit.stories.length - ready} need a detail only you know` : "Every story is ready to tell"} />
            <Stat label="Likely questions" value={String(kit.questions.length)} sub={kit.values.length ? "From your resume, the role and the employer's published hiring criteria" : "From your resume and the role"} />
            <Stat label="Gaps to answer honestly" value={String(kit.gaps.length)} sub={kit.gaps.map((g) => g.skill).join(", ") || "None in the skills recruiters search for"} />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_1fr]">
            <section aria-label="Stories" className="space-y-3">
              <h2 className="text-lg font-bold">Stories behind your resume</h2>
              {kit.stories.map((s) => (
                <article key={s.ref} className="card break-inside-avoid p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1"><p className="text-xs text-muted">{s.role}</p><p className="text-sm font-semibold">{s.line}</p></div>
                    <span className={`chip shrink-0 ${s.ready ? "bg-green-tint text-green-ink" : "bg-orange-tint text-orange-ink"}`}>{s.ready ? "Ready" : "Needs a detail"}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                    {FIELDS.map(([k, label]) => (<Fragment key={k}><dt className="font-semibold text-muted">{label}</dt><dd>{hl(String(s[k]))}</dd></Fragment>))}
                  </dl>
                  <button className="mt-3 text-[13px] font-semibold text-brand-ink hover:underline print:hidden" onClick={() => setEdit(s)}>Fill in your words</button>
                </article>
              ))}
            </section>
            <section aria-label="Likely questions" className="space-y-3">
              <h2 className="text-lg font-bold">Questions to expect</h2>
              {GROUPS.map(([g, label]) => {
                const qs = kit.questions.filter((x) => x.group === g);
                if (!qs.length) return null;
                return (
                  <div key={g} className="card break-inside-avoid p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
                    {qs.map((x) => (
                      <div key={x.q} className="border-t border-line-2 py-2.5 first-of-type:border-t-0">
                        <p className="font-semibold">{x.q}</p>
                        {x.use && <p className="text-[13px] text-ink-2"><b>Use:</b> {x.use}</p>}
                        {x.tip && <p className="text-[13px] text-muted">{x.tip}</p>}
                      </div>
                    ))}
                  </div>
                );
              })}
              {kit.values.length > 0 && (
                <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{kit.company} says it hires for</p><ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">{kit.values.map((v) => <li key={v}>{v}</li>)}</ul></div>
              )}
              {kit.gaps.map((g) => (
                <div key={g.skill} className="rounded-2xl border border-[#fde3c8] bg-[#fff7ef] p-4">
                  <p className="font-semibold">Gap to answer honestly: {g.skill}</p>
                  <p className="mt-1 text-[13px] text-ink-2">{g.script}</p>
                </div>
              ))}
            </section>
          </div>
        </>
      )}

      {edit && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-label="Edit story">
          <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5">
            <p className="text-xs text-muted">{edit.role}</p>
            <h2 className="text-lg font-bold">{edit.line}</h2>
            <p className="mt-1 text-sm text-muted">Use your own words. This stays private: it is never added to your resume.</p>
            <div className="mt-4 space-y-3">
              {FIELDS.map(([k, label]) => (
                <label key={k} className="block text-sm font-semibold">{label}
                  <textarea rows={k === "action" ? 4 : 2} className="input mt-1 py-2.5 text-sm font-normal" value={String(edit[k])} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy === "save"} onClick={saveStory}>{busy === "save" && <Loader2 size={16} className="animate-spin" />} Save story</button></div>
          </div>
        </div>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function hl(s: string) {
  return s.split(/(\[[^\]]+\])/).map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-orange-tint px-1 text-orange-ink">{p}</mark> : p));
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[13px] text-ink-2">{sub}</p>
    </div>
  );
}
