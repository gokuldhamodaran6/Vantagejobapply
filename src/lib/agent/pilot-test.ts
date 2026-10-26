import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFacts, qkeyOf } from "./fields";
import { parseResumeText } from "@/lib/resume/parse";
import type { PilotCtx } from "./pilot";

/**
 * A made-up applicant (Priya Raman, from the test fixtures) for the pilot's self-test against copies of real careers
 * sites. No real person's data is involved.
 */
export function testCtx(extra: Record<string, string> = {}): PilotCtx {
  const resume = parseResumeText(readFileSync(join(process.cwd(), "scripts/fixtures/resume-pdf.txt"), "utf8"));
  const applicant = { city: "Chicago", state: "IL", postal_code: "60601", address_line1: "1 Main St", country: "United States", phone: "(312) 555-0142", agent_consent: true, linkedin: "https://linkedin.com/in/priyaraman" };
  const auth = { country: "US", status: "post_study_work" as const, needs_sponsorship_now: false, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent" as const, details: { opt_end: "2028-01-25" } };
  const facts = buildFacts({ email: "priya.careers@gmail.com", name: "Priya Raman", applicant, resume, auth: auth as never, country: "US", prefs: { locations: [{ city: "Chicago", state: "IL", country: "US" }], remote_ok: true }, adult: true });
  const saved: Record<string, string> = {
    "Are you legally authorized to work in the country in which you are applying?": "Yes",
    "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?": "Yes",
    ...extra,
  };
  return {
    taskId: "00000000-0000-4000-8000-000000000000",
    facts,
    answers: Object.entries(saved).map(([q, a]) => ({ qkey: qkeyOf(q), question: q, answer: a })),
    job: { title: "Senior Integrated Marketing Specialist - AI Infrastructure", company: "Acme Robotics" },
    resume,
    coverLetter: "Dear Acme Robotics team,\n\nI'd like to apply.\n\nSincerely,\nPriya Raman",
    consent: true,
    approved: null,
    surface: "agent",
  };
}
