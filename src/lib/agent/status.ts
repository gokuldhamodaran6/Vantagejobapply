import { timeAgo } from "@/lib/format";

export type AgentTask = {
  id: string;
  job_id: string;
  job: { title: string; company: string; url: string; country: string; location?: string | null; match?: number | string; role_id?: string };
  ats: string | null;
  apply_url: string;
  status: string;
  step: string | null;
  needs: { id: string; qkey: string; label: string; type: string; options?: string[]; required?: boolean; kind?: "consent" | "handoff" | "submit_gate"; tried?: string; locked?: string; suggest?: string; live?: boolean }[];
  user_input: Record<string, unknown>;
  log: { at: string; text: string }[];
  resume_id: string | null;
  cover_letter: string | null;
  resume_style: string | null;
  letter_tone: string | null;
  application_id: string | null;
  error: string | null;
  attempts: number;
  priority?: number;
  started_at?: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  /** When the agent pressed the final Submit (set even if the site never confirmed). */
  submit_clicked_at?: string | null;
  /** Who cancelled: "user", "system" (setup pauses) or "duplicate" (already applied). */
  cancel_reason?: string | null;
};

export const STATUS_META: Record<string, { label: string; tone: "green" | "red" | "orange" | "blue" | "pink" | "gray"; live?: boolean; needsYou?: boolean }> = {
  awaiting_approval: { label: "Waiting for your OK", tone: "pink", needsYou: true },
  queued: { label: "In queue", tone: "gray" },
  running: { label: "Applying now", tone: "blue", live: true },
  waiting_code: { label: "Verifying email", tone: "blue", live: true },
  needs_user: { label: "Needs your answer", tone: "orange", needsYou: true },
  needs_human: { label: "Your turn", tone: "orange", live: true, needsYou: true },
  submitted: { label: "Applied", tone: "green" },
  manual: { label: "Finish on site", tone: "orange", needsYou: true },
  failed: { label: "Couldn't apply", tone: "red" },
  cancelled: { label: "Skipped", tone: "gray" },
  extension: { label: "In your browser", tone: "blue" },
};

export const ACTIVE = ["queued", "running", "waiting_code", "needs_human"];
export const NEEDS_YOU = ["awaiting_approval", "needs_user", "needs_human", "manual"];

/** One clear line for a task's state — never a stale step left over from an earlier run. */
export function statusLine(t: AgentTask, queuePos?: number) {
  switch (t.status) {
    case "queued": return t.attempts > 0 ? `Resuming${queuePos ? ` · #${queuePos} in line` : ""} — with your latest answers` : queuePos ? `Waiting in queue · #${queuePos}` : "Waiting in queue";
    case "running": return t.step || "Applying now";
    case "waiting_code": return t.step || "Reading the verification email";
    case "needs_user": return "Needs your answer";
    case "needs_human": return t.needs?.[0]?.kind === "submit_gate" ? "Filled — waiting for your Submit" : t.needs?.[0]?.kind === "handoff" ? "Your turn on the page" : "Waiting for your human check";
    case "awaiting_approval": return "Waiting for your OK";
    case "submitted": return `Applied ${timeAgo(t.finished_at || t.updated_at)}`;
    case "manual": case "failed": return t.error || t.step || "Couldn't finish on this site";
    case "cancelled": return t.cancel_reason === "duplicate" ? t.step || "Skipped — already applied" : t.cancel_reason === "system" ? t.step || "Paused by Vantage" : "Skipped by you";
    case "extension": return "Started in your browser with the Vantage extension — did you submit it?";
    default: return t.step || "";
  }
}

