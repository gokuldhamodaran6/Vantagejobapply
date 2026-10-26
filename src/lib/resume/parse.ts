import type { ResumeContent } from "@/lib/types";

/**
 * Plain text (from PDF, DOCX or paste) → structured resume, with no AI.
 * Built for real-world PDF text: wrapped bullets, right-aligned dates, skill lists broken across lines.
 */

type Section = "header" | "summary" | "skills" | "experience" | "projects" | "education" | "certifications" | "awards" | "additional";

const HEADINGS: [RegExp, Section][] = [
  [/^(professional |career |executive )?(summary|profile|objective|about( me)?|overview)$/, "summary"],
  [/^((technical|core|key|relevant) )?(skills|competencies|expertise)( (&|and) (tools|technologies|certifications))?$|^(tools|technologies|tech stack|areas of expertise|skills summary|technical proficiencies)$/, "skills"],
  [/^((professional|work|relevant|employment|career|industry|leadership) )?(experience|history|employment)( history)?$|^experience highlights$|^employment$/, "experience"],
  [/^((selected|academic|key|personal|relevant) )?projects$/, "projects"],
  [/^(education|academic background|academics|education (&|and) (training|certifications))$/, "education"],
  [/^(certifications?|licen[cs]es( (&|and) certifications)?|certifications? (&|and) (licen[cs]es|training|courses)|courses|training|professional development)$/, "certifications"],
  [/^(awards?|honou?rs( (&|and) awards)?|awards? (&|and) (recognition|honou?rs)|achievements|recognition|accomplishments)$/, "awards"],
  [/^(additional( information)?|languages|interests|volunteer( experience| work)?|activities|publications|leadership (&|and) activities)$/, "additional"],
];

const BULLET = /^\s*([•●▪◦‣∙·○■□➢➤►▶✓✔\-–*]|\d+[.)])\s+/;
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE = `(?:${MONTH}\\s*,?\\s*\\d{4}|\\d{1,2}\\/\\d{2,4}|(?:spring|summer|fall|autumn|winter)\\s+\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:–|—|-|to|until|~)\\s*(${DATE}|present|current|now|today|ongoing)`, "i");
const SINGLE_DATE_RE = new RegExp(`(?:^|[\\s|,(])(${MONTH}\\s*,?\\s*\\d{4}|(?:19|20)\\d{2})(?:$|[\\s|,)])`, "i");
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|ai|app|in|uk|ca|au|xyz|tech|site|page|design|portfolio)(?:\/[^\s|,;]*)?/gi;

const TITLE_WORDS = /\b(manager|analyst|engineer|specialist|assistant|intern|executive|developer|designer|consultant|coordinator|director|lead|associate|officer|representative|scientist|researcher|teacher|nurse|driver|founder|co-founder|head|president|strategist|administrator|architect|accountant|editor|writer|producer|technician|operator|supervisor|agent|advisor|owner|partner|fellow|trainee|apprentice|graduate assistant|teaching assistant|research assistant|marketing|sales|programmer|recruiter|controller|vp|chief|cto|ceo|cfo|cmo|principal|member)\b/i;
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|universit[éa]|iit|nit)\b/i;
const DEGREE_WORDS = /\b(bachelor|master|mba|m\.?b\.?a|ph\.?d|doctor|associate'?s? degree|diploma|certificate|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?a\.?|m\.?a\.?|bba|bca|mca|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|b\.?com|m\.?com|llb|llm|md|bsn|msn|high school|gcse|a-levels)\b/i;
const LOCATION_RE = /^(remote|hybrid|[A-Z][a-zA-Z.' -]+,\s*(?:[A-Z]{2}|[A-Z][a-zA-Z ]+)(?:,\s*[A-Z][a-zA-Z ]+)?)$/;
const VERB_START = /^(led|built|managed|created|developed|designed|launched|drove|grew|increased|reduced|improved|delivered|owned|executed|ran|produced|planned|implemented|analy[sz]ed|supported|coordinated|wrote|authored|established|negotiated|optimi[sz]ed|automated|generated|spearheaded|directed|oversaw|partnered|collaborated|conducted|maintained|organized|organised|trained|mentored|researched|scaled|shipped|streamlined|achieved|won|secured|cut|saved|boosted|expanded|introduced|redesigned|revamped|migrated|integrated|engineered|architected|facilitated|presented|prepared|handled|assisted|served|resolved|tracked|monitored|recruited|hired|taught|operated|delivered|crafted|defined|identified|transformed|accelerated|pioneered)\b/i;

function cleanLine(l: string) {
  return l.replace(/ /g, " ").replace(/[ \t]+$/g, "").replace(/\s{2,}/g, (m) => (m.length >= 3 ? "   " : " "));
}

function headingOf(line: string): Section | null {
  const t = line.replace(BULLET, "").replace(/[:|•_=]+$/g, "").replace(/^[:|•_=]+/g, "").trim();
  if (!t || t.length > 48 || /\d{4}/.test(t) || EMAIL_RE.test(t)) return null;
  const norm = t.toLowerCase().replace(/\s+/g, " ").replace(/&amp;/g, "&");
  for (const [re, sec] of HEADINGS) if (re.test(norm)) return sec;
  return null;
}

const endsSentence = (s: string) => /[.!?;:]$|\)$/.test(s.trim());

/** Join PDF line-wraps back into whole bullets. */
function toBlocks(lines: string[]): { text: string; bullet: boolean }[] {
  const out: { text: string; bullet: boolean }[] = [];
  for (const raw of lines) {
    const isB = BULLET.test(raw);
    const text = raw.replace(BULLET, "").trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    const looksHeader = RANGE_RE.test(text) || (!isB && text.length < 70 && !endsSentence(text) && /^[A-Z]/.test(text) && (TITLE_WORDS.test(text) || SCHOOL_WORDS.test(text)) && !/^[a-z]/.test(text) && prev && endsSentence(prev.text));
    const continuation =
      prev && !isB && !looksHeader &&
      ((prev.bullet && (/^[a-z(&/,%$+\d]/.test(text) || !endsSentence(prev.text) || /[—–-]$/.test(prev.text))) ||
        (!prev.bullet && /^[a-z(&/,%]/.test(text)));
    if (continuation) prev.text = `${prev.text.replace(/[—–-]$/, (m) => `${m} `)} ${text}`.replace(/\s+/g, " ").replace(/ ([,.;:])/g, "$1");
    else out.push({ text, bullet: isB || (VERB_START.test(text) && text.length > 50) });
  }
  return out;
}

function splitParts(s: string): string[] {
  return s.split(/\s{3,}|\s+[|·•]\s+|\s+[—–]\s+|\t|\s+-\s+(?=[A-Z])/).map((p) => p.trim().replace(/^[,|]|[,|]$/g, "").trim()).filter(Boolean);
}

function normDate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  const t = d.trim().replace(/\.$/, "");
  if (/^(present|current|now|today|ongoing)$/i.test(t)) return "Present";
  const m = t.match(new RegExp(`^(${MONTH})\\s*,?\\s*(\\d{4})$`, "i"));
  if (m) {
    const mon = m[1].replace(".", "").slice(0, 3);
    return `${mon[0].toUpperCase()}${mon.slice(1).toLowerCase()} ${m[2]}`;
  }
  return t.replace(/^(spring|summer|fall|autumn|winter)/i, (x) => x[0].toUpperCase() + x.slice(1).toLowerCase());
}

type Exp = NonNullable<ResumeContent["experience"]>[number];

function parseHeader(headerLines: string[]): { title: string; company: string; location?: string; start?: string; end?: string } {
  const joined = headerLines.join("   ");
  const range = joined.match(RANGE_RE);
  let start: string | undefined, end: string | undefined;
  let rest = joined;
  if (range) {
    start = normDate(range[1]);
    end = normDate(range[2]);
    rest = joined.replace(range[0], "   ");
  } else {
    const single = joined.match(SINGLE_DATE_RE);
    if (single) {
      end = normDate(single[1]);
      rest = joined.replace(single[1], "   ");
    }
  }
  rest = rest.replace(/[()]/g, " ");
  const parts: string[] = [];
  for (const line of rest.split(/\s{3,}/)) parts.push(...splitParts(line));
  // Split "Company, City, ST" into company + location.
  const pieces: string[] = [];
  const COMPANY_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|company|co|group|labs?|tech|technologies|solutions|systems|consulting|partners|agency|studios?|media|health|bank|capital|ventures|university|college|institute|school|foundation|services|global|international|pvt|gmbh|plc)\b\.?/i;
  for (const p of parts) {
    if (parts.length >= 2 && LOCATION_RE.test(p) && !TITLE_WORDS.test(p) && !COMPANY_WORDS.test(p) && !SCHOOL_WORDS.test(p)) {
      pieces.push(`@loc:${p}`);
      continue;
    }
    const m = p.match(/^(.+?),\s*([A-Z][a-zA-Z.' ]+(?:,\s*[A-Z][a-zA-Z ]+)?)$/);
    if (m && !TITLE_WORDS.test(m[2]) && (LOCATION_RE.test(m[2]) || /^[A-Z][a-z]+(?: [A-Z][a-z]+)?(, ?[A-Z]{2,}[a-z]*)?$/.test(m[2]))) pieces.push(m[1].trim(), `@loc:${m[2].trim()}`);
    else pieces.push(p);
  }
  let location = pieces.find((p) => p.startsWith("@loc:"))?.slice(5);
  const plain = pieces.filter((p) => !p.startsWith("@loc:"));
  const locIdx = plain.findIndex((p) => LOCATION_RE.test(p) && !TITLE_WORDS.test(p) && plain.length > 2);
  if (!location && locIdx >= 0) location = plain.splice(locIdx, 1)[0];
  // "Senior Analyst, Growth Marketing" stays one title; pick the piece with title words as the title.
  const titleIdx = plain.findIndex((p) => TITLE_WORDS.test(p) && !SCHOOL_WORDS.test(p));
  let title = "";
  let company = "";
  if (titleIdx >= 0) {
    title = plain[titleIdx];
    company = plain.filter((_, i) => i !== titleIdx).join(", ");
  } else {
    company = plain[0] || "";
    title = plain.slice(1).join(", ");
  }
  if (/\bat\b/i.test(title) && !company) {
    const [t, c] = title.split(/\s+at\s+/i);
    title = t;
    company = c || "";
  }
  return { title: title.trim(), company: company.trim(), location, start, end };
}

function parseExperience(lines: string[]): Exp[] {
  const blocks = toBlocks(lines);
  const jobs: Exp[] = [];
  let header: string[] = [];
  let cur: Exp | null = null;
  const flush = () => {
    if (!header.length) return;
    const h = parseHeader(header);
    cur = { title: h.title, company: h.company, location: h.location, start: h.start, end: h.end, bullets: [] };
    jobs.push(cur);
    header = [];
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isHeaderish = !b.bullet && (b.text.length < 110 || RANGE_RE.test(b.text)) && (RANGE_RE.test(b.text) || TITLE_WORDS.test(b.text) || !endsSentence(b.text));
    if (isHeaderish && (!cur || (cur as Exp).bullets.length > 0 || header.length > 0 || RANGE_RE.test(b.text))) {
      // A date range closes a header group if we already have one with a date.
      if (header.length && RANGE_RE.test(header.join(" ")) && RANGE_RE.test(b.text)) flush();
      header.push(b.text);
      if (header.length >= 3) flush();
      continue;
    }
    if (header.length) flush();
    if (!cur) {
      cur = { title: "", company: "", bullets: [] };
      jobs.push(cur);
    }
    (cur as Exp).bullets.push(b.text);
  }
  if (header.length) flush();
  return jobs
    .map((j) => ({ ...j, bullets: j.bullets.map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 2) }))
    .filter((j) => j.title || j.company || j.bullets.length);
}

function parseEducation(lines: string[]): NonNullable<ResumeContent["education"]> {
  const blocks = toBlocks(lines).map((b) => b.text);
  const out: NonNullable<ResumeContent["education"]> = [];
  let cur: NonNullable<ResumeContent["education"]>[number] | null = null;
  for (const text of blocks) {
    const range = text.match(RANGE_RE);
    const single = text.match(SINGLE_DATE_RE);
    const end = normDate(range?.[2] || single?.[1]);
    const stripped = text.replace(range?.[0] || "", " ").replace(range ? "" : single?.[1] || "", " ").replace(/\s{2,}/g, " ").replace(/[|,–—-]\s*$/, "").trim();
    const parts = splitParts(stripped);
    const hasSchool = SCHOOL_WORDS.test(stripped);
    const hasDegree = DEGREE_WORDS.test(stripped);
    if (hasSchool && (!cur || cur.school)) {
      const schoolPart = parts.find((p) => SCHOOL_WORDS.test(p)) || stripped;
      const [school, ...loc] = schoolPart.split(/,\s*/);
      cur = { school: school.trim(), degree: parts.find((p) => DEGREE_WORDS.test(p)) || "", location: loc.join(", ") || parts.find((p) => LOCATION_RE.test(p) && p !== schoolPart), end };
      out.push(cur);
    } else if (hasSchool && cur) {
      const schoolPart = parts.find((p) => SCHOOL_WORDS.test(p)) || stripped;
      const [school, ...loc] = schoolPart.split(/,\s*/);
      cur.school = school.trim();
      if (loc.length) cur.location = loc.join(", ");
      if (end) cur.end = end;
    } else if (hasDegree && (!cur || cur.degree)) {
      cur = { degree: stripped, school: "", end };
      out.push(cur);
    } else if (hasDegree && cur) {
      cur.degree = stripped;
      if (end) cur.end = end;
    } else if (cur) {
      cur.details = [cur.details, stripped].filter(Boolean).join(" ");
      if (end && !cur.end) cur.end = end;
    }
  }
  return out.filter((e) => e.degree || e.school);
}

function parseSkills(lines: string[]): NonNullable<ResumeContent["skills"]> {
  const groups: { group: string; items: string[] }[] = [];
  for (const raw of lines) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Z][A-Za-z0-9&/ +.-]{1,40}?)\s*[:–—]\s*(.+)$/);
    const prev = groups[groups.length - 1];
    if (m) {
      groups.push({ group: m[1].trim(), items: [] });
      addItems(groups[groups.length - 1], m[2], false);
    } else if (prev) {
      addItems(prev, line, true);
    } else {
      groups.push({ group: "Skills", items: [] });
      addItems(groups[groups.length - 1], line, false);
    }
  }
  return groups.map((g) => ({ group: g.group, items: [...new Set(g.items.map((i) => i.trim()).filter((i) => i.length > 1 && i.length < 70))] })).filter((g) => g.items.length);
}

function addItems(g: { items: string[] }, text: string, continuation: boolean) {
  // Split on separators, but never inside parentheses: "SQL (PostgreSQL, DuckDB)" stays one item.
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;|•·]/.test(ch)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  if (continuation && g.items.length && parts.length) {
    // A wrapped item: "B2B & B2C Campaign" + "Strategy, A/B Testing" → "B2B & B2C Campaign Strategy"
    const lastEndedClean = (g as { _ended?: boolean })._ended;
    if (!lastEndedClean) {
      g.items[g.items.length - 1] = `${g.items[g.items.length - 1]} ${parts.shift()}`.replace(/\s+/g, " ");
    }
  }
  g.items.push(...parts);
  (g as { _ended?: boolean })._ended = /[,;]\s*$/.test(text);
}

function parseList(lines: string[]): string[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const inline = clean.some((l) => /\S\s+[•·|;]\s+\S/.test(l.replace(BULLET, "")));
  let items: string[] = [];
  if (inline) {
    // "A • B • C" lists wrapped over several lines: re-join wraps, then split on separators.
    let joined = "";
    for (const l of clean) {
      const isB = BULLET.test(l);
      const t = l.replace(BULLET, "");
      joined += joined ? (isB || /[•·|;]\s*$/.test(joined) ? " • " : " ") + t : t;
    }
    items = joined.split(/\s+[•·|]\s+|;\s+/);
  } else {
    for (const b of toBlocks(clean)) {
      if (items.length && /^[a-z(&]/.test(b.text)) items[items.length - 1] += ` ${b.text}`;
      else items.push(b.text);
    }
  }
  return items.map((p) => p.replace(/^[•·|;\s]+|[•·|;\s]+$/g, "").replace(/\s+/g, " ").trim()).filter((p) => p.length > 2);
}

export function parseResumeText(raw: string, fallbackName = ""): ResumeContent {
  const lines = raw.replace(/\r/g, "").split("\n").map(cleanLine).filter((l) => l.trim().length);
  const sections: Record<Section, string[]> = { header: [], summary: [], skills: [], experience: [], projects: [], education: [], certifications: [], awards: [], additional: [] };
  let sec: Section = "header";
  for (const l of lines) {
    const h = headingOf(l.trim());
    if (h) {
      sec = h;
      continue;
    }
    sections[sec].push(l.trim());
  }

  // Header: name, contact, links, location, maybe a headline and summary.
  const all = raw.replace(/ /g, " ");
  const email = all.match(EMAIL_RE)?.[0];
  const headerText = sections.header.join("  |  ");
  const phone = (headerText.match(PHONE_RE) || all.match(PHONE_RE))?.[0]?.trim();
  const links = [...new Set((headerText.match(URL_RE) || []).filter((u) => !email || !email.includes(u.replace(/^https?:\/\//, ""))).map((u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")))];
  const headerLines = sections.header;
  const nameLine = headerLines.find((l) => !EMAIL_RE.test(l) && !PHONE_RE.test(l) && /^[A-Za-z][A-Za-z.'’ -]{2,50}$/.test(l.trim()) && l.trim().split(/\s+/).length <= 5);
  const name = (fallbackName && fallbackName.split(" ").length > 1 ? fallbackName : nameLine?.trim()) || fallbackName || "";
  let location: string | undefined;
  for (const l of headerLines) {
    for (const p of l.split(/\s*[|•·]\s*|\s{3,}/)) {
      const t = p.trim();
      if (LOCATION_RE.test(t) && !EMAIL_RE.test(t) && !/\d/.test(t)) {
        location = t;
        break;
      }
    }
    if (location) break;
  }
  const headline = headerLines.find((l) => l !== nameLine && !EMAIL_RE.test(l) && !PHONE_RE.test(l) && !URL_RE.test(l) && l.length < 90 && TITLE_WORDS.test(l) && !LOCATION_RE.test(l.trim()));
  URL_RE.lastIndex = 0;
  const headerSummary = headerLines.filter((l) => l.length > 90 && !EMAIL_RE.test(l));

  const summary = [...headerSummary, ...toBlocks(sections.summary).map((b) => b.text)].join(" ").replace(/\s+/g, " ").trim();

  const projects = parseExperience(sections.projects).map((p) => ({ name: [p.title, p.company].filter(Boolean).join(" — ") || "Project", tech: undefined, bullets: p.bullets }));

  return {
    name,
    headline: headline?.trim(),
    location,
    email,
    phone,
    links,
    summary: summary.slice(0, 1200) || undefined,
    skills: parseSkills(sections.skills),
    experience: parseExperience(sections.experience),
    projects,
    education: parseEducation(sections.education),
    certifications: parseList(sections.certifications),
    awards: parseList(sections.awards),
    additional: parseList(sections.additional),
  };
}
