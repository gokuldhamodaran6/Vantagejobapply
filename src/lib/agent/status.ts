export type AgentTask = {
  id: string;
  job_id: string;
  job: { title: string; company: string; url: string; country: string; location?: string | null; match?: number | string };
  ats: string | null;
  apply_url: string;
  status: string;
  step: string | null;
  needs: { id: string; qkey: string; label: string; type: string; options?: string[]; required?: boolean; kind?: "consent"; tried?: string }[];
  user_input: Record<string, unknown>;
  log: { at: string; text: string }[];
  resume_id: string | null;
  cover_letter: string | null;
  resume_style: string | null;
  letter_tone: string | null;
  application_id: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export const STATUS_META: Record<string, { label: string; tone: "green" | "red" | "orange" | "blue" | "pink" | "gray"; live?: boolean; needsYou?: boolean }> = {
  awaiting_approval: { label: "Waiting for your OK", tone: "pink", needsYou: true },
  queued: { label: "In queue", tone: "gray" },
  running: { label: "Applying now", tone: "blue", live: true },
  waiting_code: { label: "Verifying email", tone: "blue", live: true },
  needs_user: { label: "Needs your answer", tone: "orange", needsYou: true },
  needs_human: { label: "Human check needed", tone: "orange", live: true, needsYou: true },
  submitted: { label: "Applied", tone: "green" },
  manual: { label: "Finish on site", tone: "orange", needsYou: true },
  failed: { label: "Couldn't apply", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

export const ACTIVE = ["queued", "running", "waiting_code", "needs_human"];
export const NEEDS_YOU = ["awaiting_approval", "needs_user", "needs_human", "manual"];
