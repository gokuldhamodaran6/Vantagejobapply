import type { ResumeContent } from "@/lib/types";

/**
 * How a resume/CV is expected to look in each country. Conservative on purpose: anything personal
 * (photo, date of birth, nationality) is only ever "optional" and stays OFF unless the person opts in.
 * Pure data + helpers, safe in the browser and on the server.
 */
export type CountryFormat = {
  /** ISO-2 code, or "INTL" for the default. */
  code: string;
  name: string;
  /** Short label for copy: "UK CV", "US resume", "German CV". */
  label: string;
  docName: "Resume" | "CV";
  paper: "letter" | "a4";
  /** Page cap for an experienced person. Early-career people always get 1 (see pagesFor). */
  maxPages: 1 | 2;
  /** A short profile at the top is expected (UK/IE/AU/NZ/EU style). */
  personalStatement: boolean;
  spelling: "us" | "uk";
  /** Extra spelling guidance for the writer, e.g. Canada's mix. */
  spellingNote?: string;
  /** How experience dates are usually written. Advice only: we never rewrite a person's dates. */
  dateFormat: "MMM YYYY" | "MM/YYYY";
  photo: "never" | "optional";
  /** Date of birth, nationality, marital status. Optional ones are never added by default. */
  personalDetails: "never" | "optional";
  /** A references line is never added by default (Harvard: no reference lists). */
  references: false;
  referencesNote?: string;
  /** Section order rule: experience first, unless the person is a student/new grad or has under 2 years of experience. */
  sectionOrder: "experience-first-unless-early-career";
  note: string;
};

type Base = Omit<CountryFormat, "code" | "name" | "label" | "note" | "references" | "sectionOrder">;

const US_STYLE: Base = { docName: "Resume", paper: "letter", maxPages: 2, personalStatement: false, spelling: "us", dateFormat: "MMM YYYY", photo: "never", personalDetails: "never" };
const UK_STYLE: Base = { docName: "CV", paper: "a4", maxPages: 2, personalStatement: true, spelling: "uk", dateFormat: "MMM YYYY", photo: "never", personalDetails: "never" };
const DACH_STYLE: Base = { docName: "CV", paper: "a4", maxPages: 2, personalStatement: true, spelling: "uk", dateFormat: "MM/YYYY", photo: "optional", personalDetails: "optional" };

function make(code: string, name: string, label: string, base: Base, note: string, extra: Partial<CountryFormat> = {}): CountryFormat {
  return { code, name, label, ...base, references: false, sectionOrder: "experience-first-unless-early-career", note, ...extra };
}

export const COUNTRY_FORMATS: Record<string, CountryFormat> = {
  US: make("US", "United States", "US resume", US_STYLE, "US resume: Letter size, 1 page (2 only with 10+ years), no photo or personal details, US spelling."),
  CA: make("CA", "Canada", "Canadian resume", { ...US_STYLE, spelling: "uk" }, "Canadian resume: Letter size, 1–2 pages, no photo or personal details, Canadian spelling.", {
    spellingNote: "Canadian spelling: colour, centre, cheque, but -ize endings (organize, analyze).",
  }),
  GB: make("GB", "United Kingdom", "UK CV", UK_STYLE, "UK CV: A4, up to 2 pages, short personal statement at the top, UK spelling, no photo or date of birth."),
  IE: make("IE", "Ireland", "Irish CV", UK_STYLE, "Irish CV: A4, up to 2 pages, short personal statement at the top, UK/Irish spelling, no photo or date of birth."),
  AU: make("AU", "Australia", "Australian resume", { ...UK_STYLE, docName: "Resume" }, "Australian resume: A4, up to 2 pages, short career profile at the top, Australian (UK) spelling, no photo.", {
    referencesNote: "Australian resumes often list referees. We leave them off; share referee details when an employer asks.",
  }),
  NZ: make("NZ", "New Zealand", "NZ CV", UK_STYLE, "NZ CV: A4, up to 2 pages, short personal profile at the top, NZ (UK) spelling, no photo.", {
    referencesNote: "NZ CVs sometimes list referees. We leave them off; share them when an employer asks.",
  }),
  DE: make("DE", "Germany", "German CV", DACH_STYLE, "German CV (Lebenslauf): A4, up to 2 pages, short profile at the top, dates as MM/YYYY. A photo and personal details are common but optional; we leave them off unless you add them."),
  AT: make("AT", "Austria", "Austrian CV", DACH_STYLE, "Austrian CV: A4, up to 2 pages, short profile at the top, dates as MM/YYYY. A photo and personal details are common but optional; we leave them off unless you add them."),
  CH: make("CH", "Switzerland", "Swiss CV", DACH_STYLE, "Swiss CV: A4, up to 2 pages, short profile at the top, dates as MM/YYYY. A photo, nationality and permit status are common but optional; we leave them off unless you add them."),
  FR: make("FR", "France", "French CV", { ...UK_STYLE, photo: "optional" }, "French CV: A4, 1 page early in your career (2 at most), short profile at the top. A photo is optional; we leave it off."),
  NL: make("NL", "Netherlands", "Dutch CV", { ...UK_STYLE, photo: "optional" }, "Dutch CV: A4, up to 2 pages, short profile at the top, UK spelling for English CVs. A photo is optional; we leave it off."),
  IN: make("IN", "India", "Indian resume", { ...UK_STYLE, docName: "Resume", personalStatement: false }, "Indian resume: A4, 1–2 pages, short summary, UK spelling, no photo or personal details."),
  AE: make("AE", "United Arab Emirates", "UAE CV", { ...UK_STYLE, photo: "optional", personalDetails: "optional" }, "UAE CV: A4, up to 2 pages, short profile at the top, UK spelling. A photo, nationality and visa status are common but optional; we leave them off unless you add them."),
  SG: make("SG", "Singapore", "Singapore resume", { ...UK_STYLE, docName: "Resume", personalStatement: false }, "Singapore resume: A4, 1–2 pages, short summary, UK spelling, no photo, age or personal details."),
};

export const DEFAULT_FORMAT: CountryFormat = make(
  "INTL", "Other countries", "International resume", { ...UK_STYLE, docName: "Resume", personalStatement: false },
  "International resume: A4, 1–2 pages, short summary, no photo or personal details.",
);

/** Country codes with their own rules, in display order. */
export const FORMAT_CODES = Object.keys(COUNTRY_FORMATS);

const ALIAS: Record<string, string> = { UK: "GB", "UNITED KINGDOM": "GB", ENGLAND: "GB", SCOTLAND: "GB", WALES: "GB", USA: "US", "UNITED STATES": "US", UAE: "AE" };

export function formatFor(countryCode?: string | null): CountryFormat {
  const k = (countryCode || "").trim().toUpperCase();
  return COUNTRY_FORMATS[ALIAS[k] || k] || DEFAULT_FORMAT;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Month index (year*12+month) from "Jan 2022", "01/2022", "2022-01", "2022" or "Present". null if unreadable. */
function monthOf(d: string | undefined, now: Date): number | null {
  const s = (d || "").trim().toLowerCase();
  if (!s) return null;
  if (/present|current|now|today/.test(s)) return now.getFullYear() * 12 + now.getMonth();
  const y = s.match(/(19|20)\d{2}/)?.[0];
  if (!y) return null;
  const mName = MONTHS.findIndex((m) => s.includes(m));
  const mNum = s.match(/\b(0?[1-9]|1[0-2])\s*[/.-]\s*(19|20)\d{2}\b/)?.[1] || s.match(/\b(19|20)\d{2}\s*[/.-]\s*(0?[1-9]|1[0-2])\b/)?.[2];
  const m = mName >= 0 ? mName : mNum ? parseInt(mNum, 10) - 1 : 0;
  return parseInt(y, 10) * 12 + m;
}

/** Months of work experience from the person's own dates, or null when any role has no readable start date. */
export function experienceMonths(c: Pick<ResumeContent, "experience">, now = new Date()): number | null {
  const jobs = c.experience || [];
  if (!jobs.length) return 0;
  let total = 0;
  for (const e of jobs) {
    const start = monthOf(e.start, now);
    if (start === null) return null;
    const end = monthOf(e.end || "Present", now) ?? start;
    total += Math.max(1, end - start + 1);
  }
  return total;
}

/** Student / new grad / under 2 years of experience. Only true when we can tell from the person's own dates. */
export function isEarlyCareer(c: Pick<ResumeContent, "experience" | "education">, now = new Date()): boolean {
  const months = experienceMonths(c, now);
  if (months === null) return false;
  if (months < 24) return true;
  // Still studying: a degree that ends in the future, with little work history.
  const studying = (c.education || []).some((e) => {
    const end = monthOf(e.end, now);
    return end !== null && end > now.getFullYear() * 12 + now.getMonth() && !/present/i.test(e.end || "");
  });
  return studying && months < 36;
}

/** Harvard/recruiter rule: education first only for students, new grads, or under 2 years of experience. */
export function sectionOrderFor(c: Pick<ResumeContent, "experience" | "education">, now = new Date()): "education-first" | "experience-first" {
  return (c.education || []).length && isEarlyCareer(c, now) ? "education-first" : "experience-first";
}

/** Pages this person should aim for: 1 early in a career; US/CA keep 1 page until 10+ years; otherwise the country's cap. */
export function pagesFor(fmt: CountryFormat, c?: Pick<ResumeContent, "experience" | "education">, now = new Date()): 1 | 2 {
  if (!c) return fmt.maxPages;
  if (isEarlyCareer(c, now)) return 1;
  const months = experienceMonths(c, now) ?? 0;
  if ((fmt.code === "US" || fmt.code === "CA") && months < 120) return 1;
  if (fmt.code === "FR" && months < 60) return 1;
  return fmt.maxPages;
}

/** "UK CV · A4 · up to 2 pages · personal statement" */
export function formatLine(fmt: Pick<CountryFormat, "label" | "paper" | "personalStatement"> & { pages?: number; maxPages?: number }): string {
  const pages = fmt.pages ?? fmt.maxPages;
  return [
    fmt.label,
    fmt.paper === "a4" ? "A4" : "Letter",
    pages ? (pages === 1 ? "1 page" : `up to ${pages} pages`) : "",
    fmt.personalStatement ? "personal statement" : "",
  ].filter(Boolean).join(" · ");
}
