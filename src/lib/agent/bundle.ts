import "server-only";
import { decryptFor } from "@/lib/vault";
import { coverLetterPdf, resumePdf } from "@/lib/resume/pdf";
import { buildFacts, type Facts } from "./fields";
import { vaultHost } from "./jobs";
import { rpc } from "./svc";
import type { ResumeContent, ResumeStyle, WorkAuth } from "@/lib/types";

export type TaskRow = {
  id: string; user_id: string; job_id: string; job: { title: string; company: string; url: string; country: string; location?: string | null; role_id?: string; match?: number | string };
  ats: string; apply_url: string; status: string; mode: string; attempts: number; needs: unknown[]; user_input: Record<string, unknown>;
  resume_id: string | null; cover_letter: string | null; resume_style: string | null; letter_tone: string | null;
};

type RawBundle = {
  task: TaskRow;
  profile: { id: string; email: string; full_name: string | null; autonomy: string } | null;
  applicant: Record<string, string | boolean | null> | null;
  answers: { qkey: string; question: string; answer: string; kind: string }[];
  auth: WorkAuth[];
  resume: { content: ResumeContent; style: string | null } | null;
  master: { content: ResumeContent; style: string | null } | null;
  mail: { address: string; status: string } | null;
  vault: { host: string; login: string; secret_enc: string }[];
};

export function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export async function loadBundle(taskId: string, hostOverride?: string) {
  const t0 = await rpc<TaskRow | null>("task", { task_id: taskId });
  if (!t0) return null;
  const target = { ats: t0.ats || "generic", url: t0.apply_url, host: hostOf(t0.apply_url) };
  const host = hostOverride || vaultHost(target);
  const b = await rpc<RawBundle>("bundle", { task_id: taskId, host });
  const resume = b.resume?.content || b.master?.content || null;
  const country = b.task.job.country || "US";
  const identity = b.mail?.status === "active" || b.mail?.status === "pending" ? b.mail.address : b.profile?.email || "";
  const facts: Facts = buildFacts({ email: identity, name: b.profile?.full_name || resume?.name || "", applicant: b.applicant, resume, auth: b.auth.find((a) => a.country === country), country });
  const cred = b.vault[0];
  let password: string | null = null;
  if (cred) {
    try {
      password = decryptFor(b.task.user_id, cred.secret_enc);
    } catch {
      password = null;
    }
  }
  return { raw: b, task: b.task, target, host, resume, facts, identity, credential: cred ? { login: cred.login, password } : null, hasMailbox: Boolean(b.mail && b.mail.status !== "error") };
}

export async function filesFor(b: NonNullable<Awaited<ReturnType<typeof loadBundle>>>) {
  if (!b.resume) return { resume: null, cover: null };
  const style = (b.task.resume_style || b.raw.resume?.style || "classic") as ResumeStyle;
  const country = b.task.job.country || "US";
  const person = (b.resume.name || "Resume").replace(/[^A-Za-z0-9]+/g, "_");
  const resume = Buffer.from(await resumePdf(b.resume, { style, country })).toString("base64");
  const cover = b.task.cover_letter ? Buffer.from(await coverLetterPdf(b.task.cover_letter, b.resume, { style, country })).toString("base64") : null;
  return {
    resume: { name: `${person}_Resume.pdf`, mimeType: "application/pdf", base64: resume },
    cover: cover ? { name: `${person}_Cover_Letter.pdf`, mimeType: "application/pdf", base64: cover } : null,
  };
}
