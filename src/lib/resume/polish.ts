import type { ResumeContent } from "@/lib/types";

/**
 * Deterministic last pass on every written resume (no AI). It cannot invent anything; it only
 * orders, de-duplicates, trims filler and enforces honest positioning.
 */

type Exp = NonNullable<ResumeContent["experience"]>[number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function when(s?: string, end = false): number {
  if (!s) return end ? 0 : -1;
  if (/present|current|now/i.test(s)) return 9999 * 12;
  const y = s.match(/(19|20)\d{2}/)?.[0];
  if (!y) return -1;
  const m = MONTHS.findIndex((x) => s.toLowerCase().includes(x));
  return Number(y) * 12 + (m >= 0 ? m : end ? 11 : 0);
}

/** Reverse-chronological (current role first, by end then start date); brief "earlier" roles always last. */
export function orderExperience(exp: Exp[]): Exp[] {
  const score = (e: Exp) => [when(e.end, true), when(e.start)];
  const sorted = (xs: Exp[]) => [...xs].sort((a, b) => {
    const [ae, as] = score(a);
    const [be, bs] = score(b);
    return be - ae || bs - as;
  });
  return [...sorted(exp.filter((e) => !e.brief)), ...sorted(exp.filter((e) => e.brief))];
}

/** Clichés and AI tells recruiters flag in 2025–26, with plain replacements (null = delete the word). */
const SWAPS: [RegExp, string | null][] = [
  [/\bspearhead(ed|ing|s)?\b/gi, "led"],
  [/\butiliz(ed|ing|e|es|ation)\b/gi, "use"],
  [/\bleverag(ed|ing)\b/gi, "used"],
  [/\borchestrat(ed|ing)\b/gi, "coordinated"],
  [/\bsurge\b/gi, "increase"],
  [/\bskyrocket(ed|ing)?\b/gi, "increased"],
  [/\bin order to\b/gi, "to"],
  [/\bsuccessfully\s+/gi, null],
  [/\bseamless(ly)?\s+/gi, null],
  [/\brobust\s+/gi, null],
  [/\bcutting[- ]edge\s+/gi, null],
  [/\bstate[- ]of[- ]the[- ]art\s+/gi, null],
  [/\bbest[- ]in[- ]class\s+/gi, null],
  [/\bworld[- ]class\s+/gi, null],
  [/\bvarious\s+/gi, null],
  [/\bplayed a (key|pivotal|crucial|vital) role in\s+/gi, null],
  [/\b(a )?wide (range|variety|array) of\s+/gi, null],
  [/\bsynerg(y|ies|ize|ized)\b/gi, "collaboration"],
  [/\bdelv(e|ed|ing) (into|deep)\b/gi, "analyzed"],
  [/\bresults[- ]driven\s+/gi, null],
  [/\bdetail[- ]oriented\s+/gi, null],
  [/\bdynamic\s+/gi, null],
];

function fixCase(original: string, rep: string) {
  return /^[A-Z]/.test(original) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep;
}

/** Same tense as the word replaced: "utilizing" → "using", "spearheads" → "leads". */
function inflect(m: string, base: string): string {
  const w = m.toLowerCase();
  const forms: Record<string, [string, string, string, string]> = {
    led: ["lead", "leads", "led", "leading"],
    use: ["use", "uses", "used", "using"],
    used: ["use", "uses", "used", "using"],
    coordinated: ["coordinate", "coordinates", "coordinated", "coordinating"],
    increased: ["increase", "increases", "increased", "increasing"],
  };
  const f = forms[base];
  if (!f) return base;
  if (/ing$/.test(w)) return f[3];
  if (/ed$/.test(w)) return f[2];
  if (/s$/.test(w) && !/ss$/.test(w)) return f[1];
  if (/ation$/.test(w)) return f[0];
  return base === "led" || base === "used" || base === "coordinated" || base === "increased" ? (/(e|h|t|d)$/.test(w) && !/ed$/.test(w) ? f[0] : f[2]) : f[0];
}

/** "Utilizing" → "Using", "spearheaded" → "led": tense and capitals kept. */
export function deCliche(text: string): string {
  let t = text;
  for (const [re, rep] of SWAPS) t = t.replace(re, (m) => (rep === null ? "" : fixCase(m, inflect(m, rep))));
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^\s*([a-z])/, (m) => m.toUpperCase()).trim();
}

/** Summary sentences that waste the top of the page. */
const FILLER = /^(based in|located in|currently (based|located|residing)|residing in|seeking|looking for|open to|willing to relocate|eager to|i am|i'm|my goal|objective)/i;
export function tightenSummary(summary?: string): string | undefined {
  if (!summary) return summary;
  const sentences = summary.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => !FILLER.test(s));
  let out = (kept.length ? kept : sentences).join(" ");
  // Pronouns: "a platform I designed" → "a platform designed".
  out = out.replace(/\s+I\s+(?=[a-z]+ed\b)/g, " ").replace(/\b(my|our)\s+/gi, "");
  return deCliche(out);
}

const SENIORITY = /\b(senior|sr|junior|jr|lead|principal|staff|associate|head|chief|i{1,3}|iv|v|1|2|3|entry[- ]level|intern(ship)?|graduate|new grad|trainee|contract|remote|hybrid|part[- ]time|full[- ]time)\b/gi;
const core = (t: string) => t.toLowerCase().replace(/\(.*?\)|[,/|–—-].*$/g, " ").replace(SENIORITY, " ").replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ").trim();

/** True when the candidate has actually held this kind of title (e.g. "Digital Marketing Specialist" for "Marketing Specialist"). */
export function heldTitle(target: string, c: ResumeContent): boolean {
  const t = core(target);
  if (!t) return true;
  return (c.experience || []).some((e) => core(e.title || "").includes(t) || (t.split(" ").length === 1 ? false : t.includes(core(e.title || "")) && core(e.title || "").split(" ").length >= 2));
}

/**
 * Honest headline: never relabel the candidate as the job they're applying for. If the headline opens with a title
 * the person never held, that opening is replaced by their real professional identity; the targeted specialisms stay.
 */
export function honestHeadline(headline: string | undefined, jobTitle: string, c: ResumeContent, identity: string): string | undefined {
  // Segments are split on "|" only: "SQL · Python · Power BI" is one specialism group.
  const parts = (headline || "").split(/\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return identity || headline;
  const jt = core(jobTitle);
  const first = core(parts[0]);
  const claimsJob = jt && (first === jt || first.includes(jt) || (jt.includes(first) && first.split(" ").length >= 2));
  if (claimsJob && !heldTitle(jobTitle, c) && !heldTitle(parts[0], c)) parts[0] = identity || parts[0];
  // Max 3 segments, each short; no duplicates.
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), true))).slice(0, 3).join(" | ");
}

/** De-duplicate skills across groups, drop items that are really certifications, merge tiny groups, cap sizes. */
export function cleanSkills(skills: ResumeContent["skills"], certs: string[] = []): NonNullable<ResumeContent["skills"]> {
  const certKeys = certs.map((c) => c.toLowerCase());
  const all = (skills || []).flatMap((g) => g.items.map((i) => i.trim().toLowerCase()));
  const seen = new Set<string>();
  let groups = (skills || []).map((g) => ({
    group: g.group.trim(),
    items: g.items.map((i) => i.trim()).filter((i) => {
      const k = i.toLowerCase();
      if (!k || seen.has(k)) return false;
      // "HubSpot CRM & Marketing Automation" is a certification; "HubSpot" is the skill.
      if (k.split(" ").length >= 3 && certKeys.some((c) => c.includes(k) || k.includes(c))) return false;
      const head = k.split(/[ (]/)[0];
      if (k.split(" ").length >= 3 && head !== k && all.includes(head)) return false;
      seen.add(k);
      return true;
    }),
  })).filter((g) => g.items.length);
  // A group with one or two items reads as padding: fold it into the previous group (or the next one).
  for (let i = 0; i < groups.length; i++) {
    if (groups.length > 1 && groups[i].items.length < 3) {
      const into = groups[i - 1] || groups[i + 1];
      into.items.push(...groups[i].items);
      groups.splice(i, 1);
      i--;
    }
  }
  groups = groups.slice(0, 4).map((g) => ({ ...g, items: g.items.slice(0, 12) }));
  return groups;
}

/** Consistent bullet punctuation: every bullet ends with a period. */
function period(b: string) {
  const t = b.trim().replace(/[;,:]\s*$/, "");
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function polishResume(r: ResumeContent, opts: { jobTitle: string; identity: string; original: ResumeContent }): ResumeContent {
  const out: ResumeContent = JSON.parse(JSON.stringify(r));
  out.experience = orderExperience((out.experience || []).map((e) => ({
    ...e,
    bullets: e.brief ? [] : (e.bullets || []).map((b) => period(deCliche(b))).filter((b) => b.length > 12),
  })));
  out.summary = tightenSummary(out.summary);
  out.headline = honestHeadline(out.headline, opts.jobTitle, opts.original, opts.identity);
  out.skills = cleanSkills(out.skills, out.certifications || []);
  out.projects = (out.projects || []).map((p) => ({ ...p, bullets: (p.bullets || []).map((b) => period(deCliche(b))) }));
  return out;
}
