import type { ResumeContent } from "@/lib/types";

/**
 * "Fix my resume": find the entries that would look broken to a recruiter or an ATS, and repair what can be repaired
 * without inventing anything. Everything here is deterministic and runs in the browser.
 *
 * - auto: Vantage can fix it safely (cleaning, joining, de-duplicating, consistent dates, order).
 * - edit: only the person knows the fact (a missing date, company, email) — we point at the exact entry.
 */
export type ResumeProblem = {
  id: string;
  kind: "auto" | "edit";
  section: "contact" | "summary" | "experience" | "education" | "skills" | "projects";
  /** Which entry, e.g. "Data Analyst · Acme" */
  where: string;
  text: string;
  /** For edit problems: the experience/education index to scroll to. */
  index?: number;
};

const MOJIBAKE: [RegExp, string][] = [
  [/â€™|â€˜/g, "’"], [/â€œ|â€\u009d|â€/g, "”"], [/â€“/g, "–"], [/â€”/g, "—"], [/â€¢/g, "•"], [/Ã©/g, "é"], [/Ã¨/g, "è"], [/Ã¶/g, "ö"], [/Ã¼/g, "ü"], [/Ã¡/g, "á"], [/Ã±/g, "ñ"], [/Â /g, " "], [/Â/g, ""],
];
const hasMojibake = (s: string) => /â€|Ã[©¨¶¼¡±]|Â/.test(s);
const fixMojibake = (s: string) => MOJIBAKE.reduce((acc, [re, to]) => acc.replace(re, to), s);
const BULLET_MARK = /^\s*([•●▪■◦‣∙·*–—-]|\d+[.)])\s+/;
const isUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim());
const isCaps = (s: string) => s.length > 4 && /[A-Z]/.test(s) && s === s.toUpperCase();
const SMALL = new Set(["and", "of", "the", "for", "in", "at", "to", "a", "an", "&"]);
const ACRONYM = /^(ai|ml|ui|ux|qa|hr|it|ceo|cto|cfo|coo|vp|svp|evp|seo|sem|crm|erp|sql|api|aws|gcp|b2b|b2c|saas|pmo|rn|cpa|mba|bsc|msc|phd|usa|uk|us|eu|ii|iii|iv)$/i;
export function titleCase(s: string) {
  return s.toLowerCase().split(/(\s+|\/|-)/).map((w, i) => (ACRONYM.test(w) ? w.toUpperCase() : SMALL.has(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}
const sentence = (s: string) => {
  const l = s.toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
};

/* ---------------- dates ---------------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOW = /^(present|current|now|today|ongoing|till date|to date)$/i;
/** Months since year 0, or null. "Present" → Infinity. */
export function parseWhen(s: string | undefined): number | null {
  const v = (s || "").trim().replace(/\.$/, "");
  if (!v) return null;
  if (NOW.test(v)) return Infinity;
  let m = v.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[2] * 12 + (+m[1] - 1);
  m = v.match(/^(\d{4})[/.-](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return +m[1] * 12 + (+m[2] - 1);
  m = v.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const k = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (k >= 0) return +m[2] * 12 + k;
  }
  m = v.match(/^(\d{4})$/);
  if (m) return +m[1] * 12;
  return null;
}
const yearOnly = (s: string | undefined) => /^\d{4}$/.test((s || "").trim());
function formatWhen(n: number, original: string) {
  if (n === Infinity) return "Present";
  if (yearOnly(original)) return String(Math.floor(n / 12));
  const mo = MONTHS[n % 12];
  return `${mo.charAt(0).toUpperCase()}${mo.slice(1)} ${Math.floor(n / 12)}`;
}
const dateStyle = (s: string | undefined) => {
  const v = (s || "").trim();
  if (!v || NOW.test(v) || yearOnly(v)) return null;
  if (/^\d{1,2}[/.-]\d{4}$/.test(v)) return "numeric";
  if (/^\d{4}[/.-]\d{1,2}$/.test(v)) return "iso";
  if (/^[A-Za-z]{3}\.?\s+\d{4}$/.test(v)) return "short";
  if (/^[A-Za-z]{4,9},?\s+\d{4}$/.test(v)) return "long";
  return "other";
};

/** Indexes in most-recent-first order (current roles first, then by end and start date), or null if a date can't be read. */
function recentFirst(exp: { start?: string; end?: string }[]): number[] | null {
  const rows = exp.map((e, i) => ({ i, s: parseWhen(e.start), e: e.end?.trim() ? parseWhen(e.end) : i === 0 ? Infinity : null }));
  if (rows.some((r) => r.s === null || r.e === null)) return null;
  return [...rows].sort((a, b) => (b.e as number) - (a.e as number) || (b.s as number) - (a.s as number) || a.i - b.i).map((r) => r.i);
}

const roleName = (e: { title?: string; company?: string }) => [e.title?.trim(), e.company?.trim()].filter(Boolean).join(" · ") || "A role";
const key = (s: string | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function checkResume(c: ResumeContent | null | undefined, fullName?: string): ResumeProblem[] {
  if (!c) return [];
  const out: ResumeProblem[] = [];
  const add = (p: ResumeProblem) => out.push(p);
  const now = new Date();
  const nowN = now.getFullYear() * 12 + now.getMonth();

  // Contact
  const name = (c.name || "").trim();
  if (!name || name.split(/\s+/).length < 2 || (fullName && fullName.trim().split(/\s+/).length > name.split(/\s+/).length)) {
    if (fullName && fullName.trim().split(/\s+/).length >= 2) add({ id: "name-full", kind: "auto", section: "contact", where: "Your name", text: `The name at the top is incomplete — use "${titleCase(fullName.trim())}" from your profile.` });
    else add({ id: "name-missing", kind: "edit", section: "contact", where: "Your name", text: "Add your full name at the top." });
  } else if (isCaps(name) || name === name.toLowerCase()) add({ id: "name-case", kind: "auto", section: "contact", where: "Your name", text: `Write your name as "${titleCase(name)}" (not all capitals or lowercase).` });
  if (!c.email?.trim()) add({ id: "email-missing", kind: "edit", section: "contact", where: "Contact", text: "Add an email address — recruiters reply there." });
  else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email.trim())) add({ id: "email-bad", kind: "edit", section: "contact", where: "Contact", text: `"${c.email}" doesn't look like an email address.` });
  if (!c.phone?.trim() || c.phone.replace(/\D/g, "").length < 7) add({ id: "phone-missing", kind: "edit", section: "contact", where: "Contact", text: "Add a phone number." });

  // Summary
  if (c.summary && isUrl(c.summary)) add({ id: "summary-url", kind: "auto", section: "summary", where: "Summary", text: "Your summary is a web link — move it to your links." });
  else if (!c.summary || c.summary.trim().length < 60) add({ id: "summary-short", kind: "edit", section: "summary", where: "Summary", text: "Add a 2–3 sentence summary: who you are, years of experience, what you're best at." });

  // Experience
  const exp = c.experience || [];
  if (!exp.length) add({ id: "exp-none", kind: "edit", section: "experience", where: "Experience", text: "Add at least one role." });
  const seen = new Map<string, number>();
  exp.forEach((e, i) => {
    const w = roleName(e);
    if (!e.title?.trim() || !e.company?.trim()) add({ id: `exp-${i}-names`, kind: "edit", section: "experience", where: w, index: i, text: !e.title?.trim() ? "This role has no job title." : "This role has no company name." });
    const k = `${key(e.title)}|${key(e.company)}|${key(e.start)}`;
    if (seen.has(k) && (e.title || e.company)) add({ id: `exp-${i}-dup`, kind: "auto", section: "experience", where: w, index: i, text: "This role is listed twice — keep one." });
    else seen.set(k, i);
    const s = parseWhen(e.start), en = parseWhen(e.end);
    if (!e.start?.trim()) add({ id: `exp-${i}-start`, kind: "edit", section: "experience", where: w, index: i, text: "Add a start date (month and year)." });
    else if (s === null) add({ id: `exp-${i}-start-bad`, kind: "edit", section: "experience", where: w, index: i, text: `"${e.start}" isn't a date an ATS can read — use a month and year like "Mar 2022".` });
    if (e.end?.trim() && en === null) add({ id: `exp-${i}-end-bad`, kind: "edit", section: "experience", where: w, index: i, text: `"${e.end}" isn't a date an ATS can read — use a month and year, or "Present".` });
    if (!e.end?.trim() && i > 0 && e.start?.trim()) add({ id: `exp-${i}-end`, kind: "edit", section: "experience", where: w, index: i, text: 'Add an end date (or "Present" if you still work there).' });
    if (s !== null && en !== null && s !== Infinity && en !== Infinity && en < s) add({ id: `exp-${i}-order`, kind: "edit", section: "experience", where: w, index: i, text: "The end date is before the start date." });
    if (s !== null && s !== Infinity && s > nowN + 1) add({ id: `exp-${i}-future`, kind: "edit", section: "experience", where: w, index: i, text: "The start date is in the future." });
    if ((isCaps(e.title || "") || isCaps(e.company || "")) && (e.title || "").length < 80) add({ id: `exp-${i}-caps`, kind: "auto", section: "experience", where: w, index: i, text: "Title or company is in all capitals — write it normally." });
    const bullets = (e.bullets || []).map((b) => b.trim()).filter(Boolean);
    if (i < 2 && !bullets.length) add({ id: `exp-${i}-nobullets`, kind: "edit", section: "experience", where: w, index: i, text: "A recent role with no achievements — add 3–5 lines on what you did and the result." });
    if ((e.bullets || []).some((b) => BULLET_MARK.test(b) || (b.trim() === "" && (e.bullets || []).length > 1))) add({ id: `exp-${i}-marks`, kind: "auto", section: "experience", where: w, index: i, text: "Some lines start with typed bullet symbols or are empty — clean them up." });
    const frag = bullets.filter((b, j) => j > 0 && (/^[a-z&(]/.test(b) || b.length < 18 || /[,;—–-]$/.test(bullets[j - 1])));
    if (frag.length) add({ id: `exp-${i}-frag`, kind: "auto", section: "experience", where: w, index: i, text: `${frag.length} line${frag.length > 1 ? "s were" : " was"} cut in half when your resume was read — join them back.` });
    if (bullets.some((b) => isCaps(b) && b.length > 20)) add({ id: `exp-${i}-capsbullet`, kind: "auto", section: "experience", where: w, index: i, text: "A line is in all capitals — write it as a sentence." });
    const long = bullets.filter((b) => b.length > 330).length;
    if (long) add({ id: `exp-${i}-long`, kind: "edit", section: "experience", where: w, index: i, text: `${long} line${long > 1 ? "s are" : " is"} very long — recruiters skim; split into two or cut to the result.` });
  });
  // Most recent first (only when every date is readable).
  const order = recentFirst(exp);
  if (order && order.some((j, i) => j !== i)) add({ id: "exp-sort", kind: "auto", section: "experience", where: "Experience", text: "Roles aren't in order — put the most recent first." });
  // One date style
  const styles = new Set([...exp.flatMap((e) => [dateStyle(e.start), dateStyle(e.end)]), ...(c.education || []).map((e) => dateStyle(e.end))].filter((x): x is string => Boolean(x) && x !== "other"));
  if (styles.size > 1) add({ id: "dates-style", kind: "auto", section: "experience", where: "Dates", text: 'Dates are written in different ways — make them all look the same ("Mar 2022").' });

  // Education
  const edSeen = new Set<string>();
  (c.education || []).forEach((e, i) => {
    const w = [e.degree, e.school].filter(Boolean).join(" · ") || "A school";
    if (!e.school?.trim() || !e.degree?.trim()) add({ id: `edu-${i}-names`, kind: "edit", section: "education", where: w, index: i, text: !e.school?.trim() ? "This degree has no school." : "This school has no degree." });
    const k = `${key(e.degree)}|${key(e.school)}`;
    if (edSeen.has(k) && (e.degree || e.school)) add({ id: `edu-${i}-dup`, kind: "auto", section: "education", where: w, index: i, text: "This degree is listed twice — keep one." });
    edSeen.add(k);
    if (e.end?.trim() && parseWhen(e.end) === null) add({ id: `edu-${i}-date`, kind: "edit", section: "education", where: w, index: i, text: `"${e.end}" isn't a date an ATS can read.` });
  });

  // Skills
  const groups = c.skills || [];
  if (groups.filter((g) => /^skills?$/i.test(g.group.trim())).length > 1 || groups.some((g) => !g.items.filter((x) => x.trim()).length)) add({ id: "skills-frag", kind: "auto", section: "skills", where: "Skills", text: "Skills are split into fragments or empty groups — merge them." });
  const all = groups.flatMap((g) => g.items.map((x) => x.trim().toLowerCase()).filter(Boolean));
  if (new Set(all).size < all.length) add({ id: "skills-dup", kind: "auto", section: "skills", where: "Skills", text: `${all.length - new Set(all).size} skill${all.length - new Set(all).size > 1 ? "s are" : " is"} listed more than once.` });

  // Garbled characters anywhere
  if (hasMojibake(JSON.stringify(c))) add({ id: "chars", kind: "auto", section: "experience", where: "Whole resume", text: "Some characters came out garbled (like â€™) when your resume was read — fix them." });
  return out;
}

/** Apply every safe fix (the "auto" problems). Never adds facts; only cleans, joins, de-duplicates, orders and formats. */
export function autoFix(c0: ResumeContent, fullName?: string): ResumeContent {
  const c: ResumeContent = JSON.parse(fixMojibake(JSON.stringify(c0)));
  const name = (c.name || "").trim();
  if (fullName && fullName.trim().split(/\s+/).length >= 2 && (!name || name.split(/\s+/).length < 2 || fullName.trim().split(/\s+/).length > name.split(/\s+/).length)) c.name = titleCase(fullName.trim());
  else if (name && (isCaps(name) || name === name.toLowerCase())) c.name = titleCase(name);
  if (c.summary && isUrl(c.summary)) {
    c.links = [...new Set([...(c.links || []), c.summary.trim()])];
    c.summary = "";
  }
  // Experience: clean lines, join fragments, fix capitals, drop duplicates, consistent dates, most recent first.
  const seen = new Set<string>();
  let exp = (c.experience || []).filter((e) => {
    const k = `${key(e.title)}|${key(e.company)}|${key(e.start)}`;
    if ((e.title || e.company) && seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((e) => {
    const lines: string[] = [];
    for (const raw of e.bullets || []) {
      let b = raw.replace(BULLET_MARK, "").replace(/\s+/g, " ").trim();
      if (!b) continue;
      if (isCaps(b) && b.length > 20) b = sentence(b);
      const prev = lines[lines.length - 1];
      if (prev && (/^[a-z&(]/.test(b) || /[,;—–-]$/.test(prev) || b.length < 18)) lines[lines.length - 1] = `${prev.replace(/[;—–-]$/, "")} ${b}`.replace(/\s+/g, " ");
      else lines.push(b);
    }
    return {
      ...e,
      title: isCaps(e.title || "") ? titleCase(e.title) : e.title,
      company: isCaps(e.company || "") && (e.company || "").length > 4 ? titleCase(e.company) : e.company,
      bullets: lines.map((b) => b.replace(/\.\.$/, ".")),
    };
  });
  const styles = new Set([...exp.flatMap((e) => [dateStyle(e.start), dateStyle(e.end)]), ...(c.education || []).map((e) => dateStyle(e.end))].filter((x): x is string => Boolean(x) && x !== "other"));
  const unify = styles.size > 1;
  const fmt = (s: string | undefined) => {
    const n = parseWhen(s);
    return n === null || !s ? s : formatWhen(n, s);
  };
  if (unify) exp = exp.map((e) => ({ ...e, start: fmt(e.start), end: fmt(e.end) }));
  const order = recentFirst(exp);
  if (order) exp = order.map((j) => exp[j]);
  c.experience = exp;
  // Education
  const ed = new Set<string>();
  c.education = (c.education || []).filter((e) => {
    const k = `${key(e.degree)}|${key(e.school)}`;
    if ((e.degree || e.school) && ed.has(k)) return false;
    ed.add(k);
    return true;
  }).map((e) => (unify ? { ...e, end: fmt(e.end) } : e));
  // Skills: merge "Skills" continuation groups, drop empty groups and repeats.
  const merged: { group: string; items: string[] }[] = [];
  for (const g of c.skills || []) {
    const items = g.items.map((x) => x.trim()).filter(Boolean);
    const target = /^skills?$/i.test(g.group.trim()) ? merged.find((m) => /^skills?$/i.test(m.group.trim())) : null;
    if (target) target.items.push(...items);
    else merged.push({ group: g.group, items });
  }
  const used = new Set<string>();
  c.skills = merged.map((g) => ({ ...g, items: g.items.filter((x) => (used.has(x.toLowerCase()) ? false : (used.add(x.toLowerCase()), true))) })).filter((g) => g.items.length);
  return c;
}
