import { parseBriefRoles } from "@/lib/resume/parse";
import type { ResumeContent } from "@/lib/types";

/**
 * Repairs resumes that an older parser (or a comma-split editor field) stored broken, without inventing anything:
 * - "Euliv Tech, gd360-analytics.onrender.com" → company "Euliv Tech", url "gd360-analytics.onrender.com"
 * - "Founder & Product Lead  Independent Project" → "Founder & Product Lead (Independent Project)"
 * - an empty title with the title sitting in "location" → moved back
 * - an "Earlier experience: …" line cut into fake jobs → one brief entry per real role
 * - "Normal, IL Expected" → location "Normal, IL", end "Expected Dec 2026"
 * - skills cut inside parentheses ("SQL (PostgreSQL" + "DuckDB)") → one item
 * Pure and idempotent: a clean resume comes back unchanged.
 */

type Exp = NonNullable<ResumeContent["experience"]>[number];

const SITE = /(?:^|[\s,|]+)((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|ai|app|xyz|tech|site|page|so|sh)(?:\/\S*)?)\s*$/i;
const QUALIFIER = /^(independent project|independent venture|self[- ]employed|freelance|contract|contractor|part[- ]time|full[- ]time|internship|remote|hybrid|volunteer|consulting|seasonal|temporary|startup)$/i;
const PLACE = /^(remote|hybrid|[A-Z][a-zA-Z.' -]+,\s*(?:[A-Z]{2}|[A-Z][a-zA-Z ]+)(?:,\s*[A-Z][a-zA-Z ]+)?)$/;
const EARLIER = /^(earlier|additional|previous|prior|other|selected|early[- ]career)\s+(experience|roles|positions|work|career)\s*[:—–-]/i;
const TITLEISH = /\b(aide|assistant|analyst|manager|intern|specialist|executive|engineer|developer|designer|consultant|coordinator|director|lead|associate|officer|tutor|fellow|scientist|researcher|founder|owner|strategist|administrator|representative|advisor|teacher|instructor)\b/i;

const garbled = (e: Exp) => EARLIER.test(e.title || "") || /^[•·]/.test((e.company || "").trim()) || /\b(19|20)\d{2}\b/.test(e.company || "");

/** Split a comma list without cutting inside parentheses: "SQL (PostgreSQL, DuckDB), Python" → 2 items. */
export function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;|•]/.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function joinParenFragments(items: string[]): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const it = raw.trim();
    if (!it) continue;
    const prev = out[out.length - 1];
    const open = (s: string) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    if (prev !== undefined && open(prev) > 0) out[out.length - 1] = `${prev}, ${it}`;
    else out.push(it);
  }
  return out;
}

const range = (e: Exp) => [e.start, e.end].filter(Boolean).join(" – ");

export function repairResume(input: ResumeContent): ResumeContent {
  if (!input) return input;
  const r: ResumeContent = JSON.parse(JSON.stringify(input));

  // Experience
  const exp = r.experience || [];
  const fixed: Exp[] = [];
  for (let i = 0; i < exp.length; i++) {
    const e = { ...exp[i], bullets: [...(exp[i].bullets || [])] };
    if (garbled(e)) {
      // Rebuild the original "Earlier experience" text from the consecutive broken entries, then read it properly.
      let text = "";
      let j = i;
      while (j < exp.length && garbled(exp[j]) && !(exp[j].bullets || []).length) {
        const g = exp[j];
        text += `${text ? " " : ""}${g.title}${range(g) ? ` (${range(g)})` : ""} ${g.company || ""}`;
        j++;
      }
      const brief = parseBriefRoles(text.replace(/\s+/g, " ").trim());
      if (brief.length) {
        fixed.push(...brief);
        i = j - 1;
        continue;
      }
    }
    // A site glued onto the company.
    const site = (e.company || "").match(SITE);
    if (site && site.index! > 0 && !/@/.test(site[1])) {
      e.url ||= site[1].replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
      e.company = e.company.slice(0, site.index).replace(/[,|·\s]+$/, "").trim();
    }
    // "Title  Qualifier" (parentheses lost) → "Title (Qualifier)".
    const parts = (e.title || "").split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 2 && QUALIFIER.test(parts[1])) e.title = `${parts[0]} (${parts[1]})`;
    else if (parts.length > 1) e.title = parts.join(" ");
    // Title stored in "location" (and the place lost).
    if (!e.title?.trim() && e.location && TITLEISH.test(e.location)) {
      e.title = e.location.trim();
      e.location = exp.find((x) => x !== exp[i] && x.company === e.company && x.location && PLACE.test(x.location.trim()) && !TITLEISH.test(x.location))?.location;
    }
    // Title and company swapped ("Illinois State University" as the title).
    if (e.title && e.company && /\b(university|college|institute|school)\b/i.test(e.title) && !TITLEISH.test(e.title) && TITLEISH.test(e.company)) {
      [e.title, e.company] = [e.company, e.title];
    }
    if (!e.location) delete e.location;
    fixed.push(e);
  }
  r.experience = fixed;

  // Education: "Normal, IL Expected" + "Dec 2026" → "Normal, IL" + "Expected Dec 2026".
  r.education = (r.education || []).map((e) => {
    const x = { ...e };
    const m = (x.location || "").match(/^(.*?)[\s,]*\b(expected|anticipated)(\s+graduation)?\s*$/i);
    if (m) {
      x.location = m[1].trim() || undefined;
      if (x.end && !/expected/i.test(x.end)) x.end = `Expected ${x.end}`;
    }
    const d = (x.degree || "").match(/^(.*?)[\s,]*\b(expected|anticipated)\s*$/i);
    if (d && x.end && !/expected/i.test(x.end)) {
      x.degree = d[1].trim();
      x.end = `Expected ${x.end}`;
    }
    return x;
  });

  // Skills: rejoin items cut inside parentheses; drop exact duplicates.
  r.skills = (r.skills || []).map((g) => {
    const seen = new Set<string>();
    const items = joinParenFragments(g.items || []).filter((it) => {
      const k = it.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...g, items };
  });
  return r;
}

/** Plain-language list of what repairResume changed (for the editor banner). */
export function repairNotes(before: ResumeContent, after: ResumeContent): string[] {
  const notes: string[] = [];
  const b = before.experience || [];
  const a = after.experience || [];
  if (a.some((e) => e.brief) && !b.some((e) => e.brief)) notes.push("Rebuilt your earlier roles as clean one-line entries");
  if (a.some((e, i) => e.url && !b[i]?.url)) notes.push("Moved the product link out of the company name");
  if (a.some((e, i) => b[i] && e.title !== b[i].title)) notes.push("Fixed job titles that were split or swapped");
  if (JSON.stringify(before.education) !== JSON.stringify(after.education)) notes.push("Moved “Expected” next to the graduation date");
  if (JSON.stringify(before.skills) !== JSON.stringify(after.skills)) notes.push("Rejoined skills that were cut in half");
  return notes;
}
