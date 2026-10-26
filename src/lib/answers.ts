import { COUNTRY_BY_CODE } from "@/lib/countries";
import type { WorkAuth } from "@/lib/types";

/** Truthful, consistent answers to the work-authorization questions employers ask. */
export function workAuthAnswers(country: string, auth: WorkAuth | undefined): { q: string; a: string }[] {
  const name = COUNTRY_BY_CODE[country]?.name || country;
  if (!auth) {
    return [
      { q: `Are you legally authorised to work in ${name}?`, a: "No — I would need visa sponsorship." },
      { q: "Will you now or in the future require visa sponsorship?", a: "Yes." },
    ];
  }
  const citizenLike = auth.status === "citizen" || auth.status === "permanent_resident";
  const authorisedNow = citizenLike || !auth.needs_sponsorship_now;
  const statusText: Record<string, string> = {
    citizen: "Citizen",
    permanent_resident: "Permanent resident",
    student_visa: "Student visa",
    post_study_work: country === "US" ? "F-1 OPT (post-completion)" : country === "GB" ? "Graduate visa" : country === "CA" ? "Post-graduation work permit" : country === "AU" ? "Temporary Graduate visa (485)" : "Post-study work permit",
    work_visa: "Work visa",
    dependent_visa: "Dependant visa",
    none: "No current status",
  };
  const later = citizenLike
    ? "No."
    : auth.needs_sponsorship_now
      ? "Yes."
      : auth.needs_sponsorship_future
        ? `Yes, in the future. I don't need sponsorship to start — I'm currently authorised on my ${statusText[auth.status]}.`
        : "No.";
  const out = [
    { q: `Are you legally authorised to work in ${name}?`, a: authorisedNow ? "Yes." : "No — I would need visa sponsorship." },
    { q: "Will you now or in the future require visa sponsorship?", a: later },
    { q: "Current work authorisation", a: statusText[auth.status] },
  ];
  const optEnd = (auth.details as { opt_end?: string })?.opt_end;
  if (country === "US" && auth.status === "post_study_work" && optEnd) {
    const stem = (auth.details as { stem_degree?: boolean })?.stem_degree;
    out.push({ q: "Work authorisation end date", a: `${new Date(optEnd).toLocaleDateString(undefined, { month: "long", year: "numeric" })}${stem ? " (eligible for a 24-month STEM OPT extension with an E-Verify employer)" : ""}` });
  }
  return out;
}
