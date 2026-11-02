"use client";
import { CheckCircle2, Circle, FileText } from "lucide-react";
import { formatLine, type CountryFormat } from "@/lib/resume/country";

export type MatchReportMatch = { covered: number; total: number; skills: { skill: string; evidence: string | null }[] };
export type MatchReportHarvard = { issues: { where: string; text: string; tip: string }[]; ok: number; total: number };
export type MatchReportFormat = Pick<CountryFormat, "code" | "docName" | "paper" | "note"> & Partial<CountryFormat> & { pages?: number };

/**
 * What the tailored resume really covers for this job, the country format it follows,
 * and Harvard's bullet checks. Plain counts, no percentages: nothing here is rounded up.
 */
export function MatchReport({ match, harvard, format }: { match: MatchReportMatch; harvard: MatchReportHarvard; format: MatchReportFormat }) {
  const total = Math.max(0, match.total);
  const covered = Math.min(Math.max(0, match.covered), total);
  const label = format.label || `${format.code === "GB" ? "UK" : format.code} ${format.docName}`;
  const line = formatLine({ label, paper: format.paper, personalStatement: Boolean(format.personalStatement), pages: format.pages, maxPages: format.maxPages });
  const issues = harvard.issues.slice(0, 6);

  return (
    <div className="space-y-4">
      {total > 0 && (
        <section className="rounded-xl border border-line p-4">
          <p className="font-semibold">Covers {covered} of {total} key skills</p>
          <div className="mt-2 flex gap-1" role="meter" aria-label="Key skills covered" aria-valuemin={0} aria-valuemax={total} aria-valuenow={covered} aria-valuetext={`${covered} of ${total} key skills`}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-full ${i < covered ? "bg-green" : "bg-line"}`} />
            ))}
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {match.skills.map((s) => (
              <li key={s.skill} className="flex gap-2">
                {s.evidence ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-ink" aria-label="Covered" />
                ) : (
                  <Circle size={16} className="mt-0.5 shrink-0 text-orange-ink" aria-label="Not covered" />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{s.skill}</span>
                  {s.evidence ? (
                    <span className="block text-muted">“{s.evidence}”</span>
                  ) : (
                    <span className="block text-orange-ink">Not in your history — answer if you have it, we never add it</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 text-sm text-muted" title={format.note}>
        <FileText size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span><span className="font-medium text-ink-2">Format:</span> {line}</span>
      </p>

      <section className={`rounded-xl border border-line p-4 ${issues.length ? "" : "bg-green-tint/40"}`}>
        {harvard.total === 0 ? (
          <p className="text-sm text-muted">No bullets to check yet.</p>
        ) : issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} className="text-green-ink" aria-hidden /> All bullets pass Harvard&apos;s checks
          </p>
        ) : (
          <>
            <p className="font-semibold">Harvard checks</p>
            <p className="text-sm text-muted">{harvard.ok} of {harvard.total} bullets pass. Worth a look:</p>
            <ul className="mt-2 space-y-2 text-sm">
              {issues.map((x, i) => (
                <li key={`${x.where}-${i}`} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{x.where}</span> — <span className="text-ink-2">{x.text}</span>
                    <span className="block text-muted">{x.tip}</span>
                  </span>
                </li>
              ))}
            </ul>
            {harvard.issues.length > issues.length && <p className="mt-2 text-xs text-muted">+{harvard.issues.length - issues.length} more in the resume editor.</p>}
          </>
        )}
      </section>
    </div>
  );
}

export type StudioInfo = {
  strategy?: { identity: string; angle: string; pillars: { theme: string; proof: string }[]; gaps: { requirement: string; bridge: string }[]; questions: string[] };
  review?: { score: number; scores: Record<string, number>; strengths: string[]; fixes: string[]; risks: string[] } | null;
  knockouts?: { requirement: string; status: string; note: string }[];
  employer?: { name: string; kind: string; values: string[] };
};

const SCORE_LABELS: Record<string, string> = { first_impression: "6-second impression", relevance: "Relevance to this job", impact: "Impact & numbers", clarity: "Clarity", credibility: "Credibility", ats: "ATS keywords" };

/** How the person is presented for this job, the hiring-manager review, screening checks and questions that add real numbers. */
export function StudioReport({ info }: { info: StudioInfo }) {
  const { strategy, review, knockouts = [], employer } = info;
  const flagged = knockouts.filter((k) => k.status !== "met");
  if (!strategy?.identity && !review) return null;
  return (
    <div className="space-y-4">
      {strategy?.identity && (
        <section className="rounded-xl border border-line p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">How you&apos;re presented{employer?.name ? ` to ${employer.name}` : ""}</p>
          <p className="mt-1 font-semibold">{strategy.identity}</p>
          {strategy.angle && <p className="mt-1 text-sm text-ink-2">{strategy.angle}</p>}
          {strategy.pillars?.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {strategy.pillars.map((p) => (
                <li key={p.theme} className="flex gap-2">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-ink" aria-hidden />
                  <span><span className="font-medium">{p.theme}:</span> <span className="text-muted">{p.proof}</span></span>
                </li>
              ))}
            </ul>
          )}
          {employer?.values?.length ? <p className="mt-3 text-xs text-muted">Framed for what {employer.name} says it hires for: {employer.values.slice(0, 4).join(" · ")}</p> : null}
        </section>
      )}

      {review && review.score > 0 && (
        <section className="rounded-xl border border-line p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">Hiring-manager review</p>
            <p className="text-2xl font-bold tabular-nums">{review.score}<span className="text-sm font-medium text-muted">/100</span></p>
          </div>
          <p className="text-xs text-muted">An AI read of the final resume as this job&apos;s hiring manager would see it. 70 means they&apos;d call you.</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {Object.entries(review.scores).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k}>
                <dt className="flex justify-between text-muted"><span>{SCORE_LABELS[k] || k}</span><span className="tabular-nums text-ink-2">{v}/10</span></dt>
                <dd className="mt-1 h-1.5 rounded-full bg-line"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${v * 10}%` }} /></dd>
              </div>
            ))}
          </dl>
          {review.fixes.length > 0 && (
            <>
              <p className="mt-3 text-sm font-medium">Fixed in the review</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">{review.fixes.slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}</ul>
            </>
          )}
          {review.risks.length > 0 && (
            <>
              <p className="mt-3 text-sm font-medium">A recruiter may still ask about</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">{review.risks.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {flagged.length > 0 && (
        <section className="rounded-xl border border-orange/40 bg-orange-tint/40 p-4">
          <p className="font-semibold">Check before you apply</p>
          <p className="text-xs text-muted">Screening requirements that filter people out before anyone reads the resume.</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {flagged.map((k) => (
              <li key={k.requirement}><span className="font-medium">{k.requirement}</span> <span className="text-orange-ink">({k.status})</span>{k.note ? <span className="block text-muted">{k.note}</span> : null}</li>
            ))}
          </ul>
        </section>
      )}

      {strategy?.questions?.length ? (
        <section className="rounded-xl border border-line p-4">
          <p className="font-semibold">Make it stronger with a real number</p>
          <p className="text-xs text-muted">We never invent numbers. Add any of these to your master resume and every future resume uses them.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{strategy.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
