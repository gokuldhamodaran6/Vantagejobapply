import "server-only";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { matchFrom, type TailorResult } from "@/lib/tailor";
import type { ResumeContent } from "@/lib/types";

/**
 * What the resume written for one job covers — shown in the Chrome extension's panel while it fills the company's
 * form, and in Vantage. Counts are honest: a skill is covered only with evidence from the person's own resume.
 */
export type TaskReport = {
  covered: number;
  total: number;
  matched: string[];
  missing: string[];
  format: { code: string; label: string; docName: string; paper: string; pages?: number; note: string };
  harvard: { ok: number; total: number };
  resumeId?: string | null;
  /** How the person is presented ("Business & Data Analyst") and why they fit, in one line. */
  identity?: string;
  angle?: string;
  /** Hiring-manager review of the final resume (AI estimate, 0–100). */
  review?: number | null;
  fixes?: string[];
  /** Screening requirements that aren't clearly met (work authorization, degree, years…). */
  knockouts?: { requirement: string; status: string; note: string }[];
  /** Questions that would add a real number to this resume. */
  questions?: string[];
  employer?: string;
};

type FormatLike = { code: string; label?: string; name?: string; docName: string; paper: string; pages?: number; note: string };

export function buildReport(input: {
  match: { covered: number; total: number; skills: { skill: string; evidence: string | null }[] };
  format: FormatLike;
  harvard: { ok: number; total: number };
  resumeId?: string | null;
  extra?: Pick<TaskReport, "identity" | "angle" | "review" | "fixes" | "knockouts" | "questions" | "employer">;
}): TaskReport {
  const { match, format, harvard } = input;
  return {
    covered: Math.max(0, Math.min(match.covered, match.total)),
    total: Math.max(0, match.total),
    matched: match.skills.filter((s) => s.evidence).map((s) => s.skill).slice(0, 8),
    missing: match.skills.filter((s) => !s.evidence).map((s) => s.skill).slice(0, 6),
    format: { code: format.code, label: format.label || `${format.code} ${format.docName}`, docName: format.docName, paper: format.paper, pages: format.pages, note: format.note },
    harvard: { ok: harvard.ok, total: harvard.total },
    resumeId: input.resumeId ?? null,
    ...(input.extra || {}),
  };
}

export function reportFromTailoring(t: TailorResult, own: ResumeContent, resumeId: string | null): TaskReport {
  return buildReport({ match: matchFrom(t.analysis, t.keywords, own), format: t.format, harvard: t.harvard, resumeId, extra: extraFrom(t) });
}

/** The studio's positioning, review and screening checks, trimmed for the report. */
export function extraFrom(t: Pick<TailorResult, "strategy" | "review" | "knockouts" | "employer">): NonNullable<Parameters<typeof buildReport>[0]["extra"]> {
  return {
    identity: t.strategy?.identity || undefined,
    angle: t.strategy?.angle || undefined,
    review: t.review?.score ?? null,
    fixes: (t.review?.fixes || []).slice(0, 5),
    knockouts: (t.knockouts || []).filter((k) => k.status !== "met").slice(0, 4),
    questions: (t.strategy?.questions || []).slice(0, 4),
    employer: t.employer?.name,
  };
}

export async function saveReport(taskId: string, report: TaskReport) {
  const { error } = await supabaseAnon().rpc("task_report", { secret: ingestSecret(), op: "set", args: { task_id: taskId, report } });
  if (error) console.error("task_report set failed", error.message);
}

export async function loadReport(taskId: string) {
  const { data, error } = await supabaseAnon().rpc("task_report", { secret: ingestSecret(), op: "get", args: { task_id: taskId } });
  if (error) throw new Error(error.message);
  return data as { user_id: string; status: string; ready: boolean; resume_id: string | null; report: TaskReport | null } | null;
}
