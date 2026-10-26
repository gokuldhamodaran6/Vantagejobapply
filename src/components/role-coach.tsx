"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import type { Coach, CoachAnswer } from "@/lib/resume/coach";

type RoleRow = { id: string; title: string; coach: Coach };
const titleCase = (t: string) => (t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : t);

/** A short conversation with a recruiter-minded coach, then a rewrite that uses what the user said. */
export function RoleCoach({ role, onClose, onDone }: { role: RoleRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [coach, setCoach] = useState<Coach | null>(role.coach?.questions ? role.coach : null);
  const [answers, setAnswers] = useState<CoachAnswer[]>(role.coach?.answers || []);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (coach) return;
    fetch("/api/resume/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assess", roleId: role.id }) })
      .then((r) => r.json()).then((d) => (d.coach ? setCoach(d.coach) : setErr(d.error || "Couldn't start the coach.")))
      .catch(() => setErr("Network error."));
  }, [coach, role.id]);

  const qs = coach?.questions || [];
  const cur = qs[step];
  useEffect(() => {
    const prev = answers.find((a) => a.key === cur?.key)?.a || "";
    setDraft(prev);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, coach]);

  function next(skip = false) {
    if (!cur) return;
    const rest = answers.filter((a) => a.key !== cur.key);
    const updated = skip ? rest : [...rest, { key: cur.key, q: cur.q, a: draft.trim() }];
    setAnswers(updated);
    if (step + 1 < qs.length) setStep(step + 1);
    else finish(updated);
  }

  async function finish(final: CoachAnswer[]) {
    setWriting(true);
    setStep(qs.length);
    const r = await fetch("/api/resume/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", roleId: role.id, answers: final }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : { error: "Network error." };
    setWriting(false);
    if (!r?.ok) return setErr(d.error || "Couldn't write the resume.");
    onDone(`Your ${role.title} resume is rewritten with what you told us — ATS ${d.score}.`);
  }

  const fit = coach?.fit;
  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={`${role.title} coach`}>
      <button className="absolute inset-0 bg-ink/40" aria-label="Close" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-pink text-white"><Sparkles size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">Position you for {titleCase(role.title)}</h2>
            <p className="text-sm text-muted">A few questions a top recruiter would ask. Short answers are fine.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
        </div>
        {qs.length > 0 && <div className="h-1 bg-line-2"><div className="h-full bg-gradient-to-r from-brand to-pink transition-all" style={{ width: `${(Math.min(step, qs.length) / qs.length) * 100}%` }} /></div>}

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!coach && !err && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Reading your resume against live {role.title} postings…</div>}
          {err && <p className="rounded-lg bg-red-tint px-3 py-2 text-sm text-red-ink">{err}</p>}
          {fit && (
            <Bubble>
              <p>{fit.why}</p>
              {fit.missing.length > 0 && <p className="mt-2 text-muted">Live {role.title} postings often ask for: <b className="text-ink">{fit.missing.slice(0, 6).join(", ")}</b>. If you&apos;ve touched any of these, I&apos;ll make sure it shows — truthfully.</p>}
            </Bubble>
          )}
          {qs.slice(0, Math.min(step + 1, qs.length)).map((q, i) => {
            const a = answers.find((x) => x.key === q.key);
            return (
              <div key={q.key} className="space-y-3">
                <Bubble><p className="font-medium">{q.q}</p>{q.hint && <p className="mt-1 text-xs text-muted">{q.hint}</p>}</Bubble>
                {i < step && <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white">{a?.a || <span className="italic opacity-80">Skipped</span>}</div>}
              </div>
            );
          })}
          {step >= qs.length && qs.length > 0 && (
            <Bubble>{writing ? <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Rewriting your {role.title} resume with this — about 30 seconds…</span> : <span>Done.</span>}</Bubble>
          )}
          <div ref={endRef} />
        </div>

        {cur && step < qs.length && (
          <form className="border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); next(); }}>
            <textarea autoFocus rows={3} className="input py-2.5 font-normal" placeholder="Type your answer" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); next(); } }} aria-label="Your answer" />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted">{step + 1} of {qs.length}</span>
              {step > 0 && <button type="button" className="btn-ghost min-h-9 text-[13px]" onClick={() => setStep(step - 1)}>Back</button>}
              <button type="button" className="btn-ghost ml-auto min-h-9 text-[13px]" onClick={() => next(true)}>Skip</button>
              <button className="btn-primary min-h-9 text-[13px]" disabled={!draft.trim()}>{step + 1 === qs.length ? "Write my resume" : "Next"} <ArrowRight size={15} /></button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-canvas px-4 py-3 text-sm leading-relaxed">{children}</div>;
}
