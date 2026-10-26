import type { Sponsorship } from "@/lib/types";

// Phrases are matched case-insensitively against title + description.
const OFFERS = [
  /visa sponsorship (is )?(available|offered|provided|possible)/,
  /(we|will|can|able to|happy to|willing to) (offer |provide )?sponsor/,
  /sponsorship (is )?(available|offered|provided|considered)/,
  /(h-?1b|h1-?b) (sponsorship|transfer)s? (available|welcome|considered|supported)/,
  /skilled worker (visa|sponsorship|route)/,
  /certificate of sponsorship/,
  /tier ?2 sponsorship/,
  /lmia (support|approved|available|provided)/,
  /(482|skills in demand|sid) visa sponsorship/,
  /relocation (and|&) visa (support|sponsorship)/,
  /visa (support|assistance) (is )?(available|provided|offered)/,
];

const NO_SPONSOR = [
  /(not|unable to|cannot|can't|won't|will not|do not|does not|don't) (be able to )?(offer |provide |support )?(visa )?sponsor/,
  /no (visa )?sponsorship/,
  /sponsorship (is )?(not|un)available/,
  /without (the need for )?(current or future |now or in the future )?(visa )?sponsorship/,
  /must (currently )?(have|hold|possess) (the )?(full |existing |unrestricted )?(right|authori[sz]ation|eligibility) to work/,
  /must be (legally )?(authori[sz]ed|eligible) to work in the (us|u\.s\.|united states|uk|united kingdom|canada|australia)[^.]{0,60}without/,
  /not (able|in a position) to (offer|provide|support) (visa|work permit)/,
];

const RESTRICTIONS: [RegExp, string][] = [
  [/(us|u\.s\.|united states) citizen(s|ship)? (only|required)|must be a (us|u\.s\.) citizen/, "Citizens only"],
  [/(british|uk) (citizen|national)s? only|must be a (british|uk) (citizen|national)/, "Citizens only"],
  [/(canadian citizen|permanent resident) (only|required)|must be a canadian citizen/, "Citizens/PR only"],
  [/australian citizen(s|ship)? (only|required)|must be an australian citizen/, "Citizens only"],
  [/(active|current) (secret|top secret|ts\/sci|security) clearance|security clearance (is )?required|sc clearance|dv clearance|baseline clearance/, "Security clearance"],
  [/green card holders? only|us persons? only|itar/, "US persons only"],
];

export type TextSignals = {
  sponsorship: Sponsorship;
  restrictions: string[];
  remote: boolean;
  level: "intern" | "entry" | "mid" | "senior" | "lead" | null;
  yearsRequired: number | null;
};

export function analyzeText(title: string, description: string | null | undefined): TextSignals {
  const t = (title || "").toLowerCase();
  const d = (description || "").toLowerCase().replace(/\s+/g, " ");
  const all = `${t} ${d}`;

  let sponsorship: Sponsorship = "silent";
  if (NO_SPONSOR.some((r) => r.test(all))) sponsorship = "no";
  else if (OFFERS.some((r) => r.test(all))) sponsorship = "offers";
  if (!d) sponsorship = "unknown";

  const restrictions = Array.from(new Set(RESTRICTIONS.filter(([r]) => r.test(all)).map(([, label]) => label)));

  const remote = /\bremote\b|work from home|wfh|anywhere in/.test(t) || /\bfully remote\b|100% remote|remote-first/.test(d);

  let level: TextSignals["level"] = null;
  if (/\bintern(ship)?\b|\bco-?op\b|placement year|working student/.test(t)) level = "intern";
  if (!level) {
    if (/\b(director|head of|vp|vice president|chief|principal|staff|senior manager|sr\.? manager|group product manager|general manager)\b/.test(t)) level = "lead";
    else if (/\b(lead|team lead|tech lead)\b/.test(t)) level = "lead";
    else if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) level = "senior";
    else if (/\b(junior|jr\.?|graduate|grad|entry[- ]level|associate|trainee|apprentice|new grad|early career)\b|\b(i|1)\b$/.test(t)) level = "entry";
    else if (/\b(ii|2|mid[- ]level)\b/.test(t)) level = "mid";
  }

  let yearsRequired: number | null = null;
  const m = d.match(/(\d{1,2})\+?\s*(?:-|to|–)?\s*(?:\d{1,2})?\s*\+?\s*years?(?:'|’)?\s*(?:of\s+)?(?:relevant |professional |industry |hands-on |work )?experience/);
  if (m) yearsRequired = Math.min(20, parseInt(m[1], 10));
  if (!level && yearsRequired !== null) {
    level = yearsRequired <= 1 ? "entry" : yearsRequired <= 4 ? "mid" : yearsRequired <= 8 ? "senior" : "lead";
  }

  return { sponsorship, restrictions, remote, level, yearsRequired };
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function normCompany(n: string): string {
  return (n || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|incorporated|llc|ltd|limited|plc|corp|corporation|co|company|group|holdings|gmbh|pty|pvt|private|llp|lp|sa|ag|bv|nv|uk|usa|us)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
