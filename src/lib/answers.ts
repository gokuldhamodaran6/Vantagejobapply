import { COUNTRY_BY_CODE } from "@/lib/countries";
import type { WorkAuth } from "@/lib/types";

const STATUS_TEXT = (country: string): Record<string, string> => ({
  citizen: "Citizen",
  permanent_resident: "Permanent resident",
  student_visa: "Student visa",
  post_study_work: country === "US" ? "F-1 OPT (post-completion, EAD)" : country === "GB" ? "Graduate visa" : country === "CA" ? "Post-graduation work permit" : country === "AU" ? "Temporary Graduate visa (485)" : "Post-study work permit",
  work_visa: "Work visa",
  dependent_visa: "Dependant visa",
  none: "No current status",
});

/**
 * Whether the person can legally start a job today without a new visa.
 * Post-study permits (OPT, Graduate, PGWP, 485) authorise work until they end,
 * so they never need sponsorship *to start* while the permit is valid.
 */
export function authorisedNow(auth: WorkAuth | undefined): boolean {
  if (!auth) return false;
  if (auth.status === "citizen" || auth.status === "permanent_resident") return true;
  if (auth.status === "post_study_work") {
    const end = (auth.details as { opt_end?: string })?.opt_end;
    return !end || Date.parse(end) > Date.now();
  }
  return !auth.needs_sponsorship_now;
}

export function needsSponsorshipLater(auth: WorkAuth | undefined): boolean {
  if (!auth) return true;
  if (auth.status === "citizen" || auth.status === "permanent_resident") return false;
  return auth.needs_sponsorship_future || auth.needs_sponsorship_now;
}

/** Truthful, consistent answers to the work-authorisation questions employers ask. */
export function workAuthAnswers(country: string, auth: WorkAuth | undefined): { q: string; a: string; key: string }[] {
  const name = COUNTRY_BY_CODE[country]?.name || country;
  if (!auth) {
    return [
      { key: "work_authorized", q: `Are you legally authorised to work in ${name}?`, a: "No" },
      { key: "sponsorship", q: "Will you now or in the future require visa sponsorship?", a: "Yes" },
    ];
  }
  const now = authorisedNow(auth);
  const later = needsSponsorshipLater(auth);
  const status = STATUS_TEXT(country)[auth.status];
  const out = [
    { key: "work_authorized", q: `Are you legally authorised to work in ${name}?`, a: now ? "Yes" : "No" },
    {
      key: "sponsorship",
      q: "Will you now or in the future require visa sponsorship?",
      a: !later ? "No" : now ? "Yes" : "Yes",
    },
    { key: "sponsorship_detail", q: "Sponsorship details", a: !later ? "I don't need sponsorship." : now ? `I'm authorised to work now on my ${status} and will need sponsorship in the future.` : "I would need visa sponsorship to start." },
    { key: "work_status", q: "Current work authorisation", a: status },
  ];
  const optEnd = (auth.details as { opt_end?: string })?.opt_end;
  if (country === "US" && auth.status === "post_study_work" && optEnd) {
    const stem = (auth.details as { stem_degree?: boolean })?.stem_degree;
    out.push({ key: "auth_end", q: "Work authorisation end date", a: `${new Date(optEnd).toLocaleDateString("en-US", { month: "long", year: "numeric" })}${stem ? " (eligible for a 24-month STEM OPT extension with an E-Verify employer)" : ""}` });
  }
  return out;
}
