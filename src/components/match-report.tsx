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
