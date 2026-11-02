import { resumeText } from "@/lib/ats";
import { pagesFor, type CountryFormat } from "@/lib/resume/country";
import type { ResumeContent } from "@/lib/types";

/** Shared truth rules, schema, letter checks and the honesty guard used by every resume writer. */

export const TRUTH = `NON-NEGOTIABLE TRUTH RULES
- Use only facts present in the candidate's resume. Never invent employers, titles, dates, degrees, tools, certifications, metrics, team sizes or outcomes.
- You may rephrase, merge, reorder, trim and emphasise existing facts, and use the job's vocabulary when the resume already shows that work.
- Numbers: keep every number exactly as given. Never add a number that is not in the resume.
- If a requirement is not supported by the resume, leave it out. Do not imply experience the candidate does not have.`;

export const RESUME_CRAFT = `RESUME CRAFT (what top recruiters and hiring managers reward)
- Bullets follow "accomplished [X] as measured by [Y] by doing [Z]" when the facts allow. Lead with the outcome, then the how.
- Start every bullet with a strong, specific past-tense verb (present tense for a current role). Vary verbs; never repeat the same opening verb within a role.
- No first person (I, my, we), no "Responsible for", "Helped", "Worked on", "Tasked with", no filler adjectives (dynamic, passionate, results-driven, hard-working, detail-oriented, team player).
- One idea per bullet, 1–2 lines (under ~200 characters). Most relevant bullets first. 3–5 bullets for recent roles, 1–3 for older or less relevant ones.
- Summary: 2–3 lines, no pronouns. Who they are (target-role language + years of experience computed from dates), their sharpest specialism, and 1–2 signature results with real numbers.
- Headline: the target role title plus 2–3 core specialisms separated by " | " (only specialisms the resume proves).
- Skills: 3–5 groups with standard names (e.g. "Marketing", "Analytics", "Tools", "Languages"). Most relevant first. Remove items irrelevant to the target. No soft skills in the skills section.
- Keep all jobs (no unexplained gaps); keep dates exactly. Keep standard section names so every ATS can parse it.
- Spelling: follow the job's country (US vs UK/Commonwealth spelling).`;

export const BANNED = [
  "i am writing to express", "i am excited to apply", "i am thrilled", "i'm thrilled", "passionate about", "dynamic", "synergy", "go-getter", "team player",
  "hard-working", "hardworking", "detail-oriented", "results-driven", "i believe i would be a great fit", "perfect fit", "leverage my skills",
  "fast-paced environment", "esteemed", "to whom it may concern", "dear sir", "dear madam", "delve", "tapestry", "testament to", "in today's",
  "ever-evolving", "unwavering", "spearheaded a culture", "i am confident that i", "look no further", "game-changer", "cutting-edge", "seamlessly",
  "rest assured", "embark", "journey", "realm", "elevate", "foster a culture", "aligns perfectly", "resonates deeply", "honed", "invaluable",
];

/** Country rules for the writer: spelling, profile, length, and what never goes on a resume. */
export function formatPrompt(fmt: CountryFormat, c?: ResumeContent): string {
  const pages = pagesFor(fmt, c);
  return `COUNTRY FORMAT: ${fmt.label} (${fmt.name})
- Spelling: ${fmt.spelling === "us" ? "US spelling (organize, color, center, analyze)." : fmt.spellingNote || "UK/Commonwealth spelling (organise, colour, centre, analyse)."}
- ${fmt.personalStatement ? `Top of the ${fmt.docName}: a short personal statement in "summary" (2–4 lines, no pronouns): who they are in the target role's language, their strongest proven skills, and what they bring. Facts from the resume only.` : "Summary: 2–3 lines, no pronouns, facts from the resume only."}
- Length: aim for ${pages === 1 ? "1 page" : "no more than 2 pages"} on ${fmt.paper === "a4" ? "A4" : "US Letter"}.
- Never add a photo, date of birth, age, nationality, marital status, gender, religion or a "References available on request" line.
- Keep every date exactly as written.`;
}

export const SCHEMA = `{"name":string,"headline":string,"location":string,"email":string,"phone":string,"links":string[],"summary":string,"skills":[{"group":string,"items":string[]}],"experience":[{"title":string,"company":string,"location":string,"start":string,"end":string,"bullets":string[]}],"projects":[{"name":string,"tech":string,"bullets":string[]}],"education":[{"degree":string,"school":string,"location":string,"end":string,"details":string}],"certifications":string[],"awards":string[],"additional":string[]}`;

export function lintLetter(text: string, company: string): string[] {
  const t = text.toLowerCase();
  const issues: string[] = [];
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 170) issues.push(`too short (${words} words, aim for 220–320)`);
  if (words > 380) issues.push(`too long (${words} words, aim for 220–320)`);
  for (const b of BANNED) if (t.includes(b)) issues.push(`remove the cliché "${b}"`);
  if (/\[[^\]]{2,40}\]|\{[^}]{2,40}\}|<[^>]{2,40}>/.test(text)) issues.push("remove placeholder brackets");
  if (/[—–-]\s*[.,;]/.test(text) || /\s[,.;]/.test(text)) issues.push("fix broken punctuation");
  if ((text.match(/—/g) || []).length > 1) issues.push("use at most one em dash");
  if (/!/.test(text)) issues.push("remove exclamation marks");
  const sentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.length > 3);
  const iStarts = sentences.filter((s) => /^I\b/.test(s.trim())).length;
  if (sentences.length && iStarts / sentences.length > 0.35) issues.push("too many sentences start with “I”; vary the openings");
  if (company && !t.includes(company.toLowerCase().split(/[ ,]/)[0])) issues.push(`mention ${company} by name`);
  if (/\b(ai|chatgpt|claude|language model|vantage)\b/i.test(text)) issues.push("remove any mention of tools or AI");
  return issues;
}

export function tidyLetter(s: string) {
  return s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

export function norm(s: string) {
  return ` ${s.toLowerCase().replace(/[^a-z0-9%$+#.& ]/g, " ").replace(/\s+/g, " ")} `;
}
export function coverage(sentence: string, src: string) {
  const toks = norm(sentence).trim().split(" ").filter((w) => w.length > 2);
  if (!toks.length) return 1;
  return toks.filter((w) => src.includes(` ${w} `)).length / toks.length;
}

/** Keep the AI's rewrite honest: same jobs and dates, no invented skills or numbers. */
/**
 * Words in a bullet that look like a named tool, platform or skill ("Snowflake", "dbt", "Tableau") and are in the job
 * posting but nowhere in the candidate's own resume: the classic way a writer stuffs unproven keywords.
 */
export function unprovenTerms(bullet: string, src: string, jobText: string, anyCapital = false): string[] {
  if (!jobText) return [];
  const job = norm(jobText);
  const words = bullet.match(/\b[A-Za-z][A-Za-z0-9+#.]*[A-Za-z0-9+#]\b/g) || [];
  const out: string[] = [];
  for (const [i, w] of words.entries()) {
    const looksNamed = /[A-Z]/.test(w.slice(1)) || /[0-9+#.]/.test(w) || ((i > 0 || anyCapital) && /^[A-Z]/.test(w));
    if (!looksNamed || w.length < 2) continue;
    const k = norm(w).trim();
    if (!k || src.includes(` ${k} `)) continue;
    if (job.includes(` ${k} `)) out.push(w);
  }
  return out;
}

export function guard(original: ResumeContent, out: ResumeContent, jobText = ""): ResumeContent {
  const src = norm(resumeText(original));
  const numbers = new Set((resumeText(original).match(/\d[\d,.]*%?\+?/g) || []).map((n) => n.replace(/[,+]/g, "")));
  const r = clean(out);
  r.name = original.name || r.name;
  r.email = original.email;
  r.phone = original.phone;
  r.links = original.links;
  r.location = original.location || r.location;
  // Skills must exist in the original. "Python (pandas, FastAPI)" counts when Python, pandas and FastAPI each do;
  // when only the main skill is proven, the brackets are dropped ("SQL (window functions)" → "SQL").
  const has = (t: string) => Boolean(norm(t).trim()) && src.includes(norm(t));
  r.skills = (r.skills || []).map((g) => ({
    ...g,
    items: g.items.map((i) => {
      if (has(i)) return i;
      const head = i.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
      const inner = (i.match(/\((.*?)\)/)?.[1] || "").split(/[,/;]|\band\b/).map((x) => x.trim()).filter(Boolean);
      if (!head || !has(head)) return null;
      const kept = inner.filter(has);
      return kept.length ? `${head} (${kept.join(", ")})` : head;
    }).filter((i): i is string => Boolean(i)),
  })).filter((g) => g.items.length);
  // Never lose a core skill the job asks for: an original skill named in the posting that the writer dropped goes back in.
  if (jobText && (original.skills || []).length && r.skills.length) {
    const job = norm(jobText);
    const present = norm(r.skills.flatMap((g) => g.items).join(" | "));
    const missing = (original.skills || []).flatMap((g) => g.items).filter((i) => {
      const head = i.replace(/\(.*?\)/g, " ").replace(/\b(advanced|basic|intermediate|expert|proficient|microsoft|ms)\b/gi, " ").replace(/\s+/g, " ").trim();
      return head.length > 1 && job.includes(norm(head)) && !present.includes(norm(head));
    });
    if (missing.length) {
      const target = r.skills.find((g) => /data|analytic|technical|tool|language|program|bi\b|stack/i.test(g.group)) || r.skills[0];
      target.items = [...missing, ...target.items];
    }
  }
  // Jobs and dates must match the original; bullets must not introduce new numbers.
  const byKey = new Map((original.experience || []).map((e) => [`${norm(e.company)}|${(e.start || "").toLowerCase()}`, e]));
  r.experience = (r.experience || []).map((e) => {
    const o = byKey.get(`${norm(e.company)}|${(e.start || "").toLowerCase()}`) || (original.experience || []).find((x) => norm(x.company) === norm(e.company) && norm(x.title) === norm(e.title));
    const bullets = (e.bullets || []).filter((b) => (b.match(/\d[\d,.]*%?\+?/g) || []).every((n) => numbers.has(n.replace(/[,+]/g, ""))) && !unprovenTerms(b, src, jobText).length);
    if (!o) return null;
    const keep = { title: o.title, company: o.company, start: o.start, end: o.end, location: o.location, ...(o.url ? { url: o.url } : {}), ...(o.brief ? { brief: true } : {}) };
    return { ...e, ...keep, bullets: o.brief ? [] : bullets.length ? bullets : o.bullets };
  }).filter((e): e is NonNullable<typeof e> => Boolean(e)).filter((e, i, all) => all.findIndex((x) => norm(x.company) === norm(e.company) && x.start === e.start && norm(x.title) === norm(e.title)) === i);
  // Shared credit stays shared: if the source said "contributing to a 35% increase", the rewrite may not say "drove a 35% increase".
  const SHARED = /\b(contribut\w*|helped|help(ing)?|supported|supporting|assisted|as part of|part of a team|alongside)\b/i;
  for (const e of r.experience) {
    const o = (original.experience || []).find((x) => norm(x.company) === norm(e.company) && x.start === e.start);
    if (!o) continue;
    e.bullets = e.bullets.map((b) => {
      const nums = (b.match(/\d[\d,.]*%/g) || []).map((n) => n.replace(/,/g, ""));
      const src0 = (o.bullets || []).find((ob) => nums.some((n) => ob.replace(/,/g, "").includes(n)));
      // The rewrite claimed the whole result: use the person's own (shared-credit) wording for this one.
      return src0 && SHARED.test(src0) && !SHARED.test(b) ? src0 : b;
    });
  }
  if (r.summary) {
    for (const ob of (original.experience || []).flatMap((x) => x.bullets || [])) {
      if (!SHARED.test(ob)) continue;
      for (const n of ob.match(/\d[\d,.]*%/g) || []) {
        r.summary = r.summary.replace(new RegExp(`\\b(drove|driving|delivered|delivering|expanded|expanding|accelerated|accelerating|grew|growing|boosted|boosting|generated|generating|increased|increasing)\\b([^.]{0,60}?${n.replace(/[.%]/g, "\\$&")})`, "i"), (_m, _v, rest) => `contributing to${rest}`);
      }
    }
  }
  // Never drop a job: append any the model removed, as-is.
  for (const o of original.experience || []) {
    if (!r.experience.some((e) => norm(e.company) === norm(o.company) && e.start === o.start)) r.experience.push(o);
  }
  // Headline specialisms must be things the person has, not the posting's wish list.
  if (r.headline) r.headline = r.headline.split(/\s+[|·•]\s+/).filter((seg, i) => i === 0 || !unprovenTerms(seg, src, jobText, true).length).join(" | ");
  r.education = original.education;
  r.certifications = (r.certifications || []).filter((c) => (original.certifications || []).some((o) => norm(o).includes(norm(c).trim().split(" ").slice(0, 2).join(" "))));
  if (!r.certifications.length) r.certifications = original.certifications;
  r.awards = original.awards;
  if (r.summary && (r.summary.match(/\d[\d,.]*%?\+?/g) || []).some((n) => !numbers.has(n.replace(/[,+]/g, "")) && !/^\d{1,2}$/.test(n))) r.summary = original.summary;
  return r;
}

export function clean(c: ResumeContent): ResumeContent {
  const s = (x?: string) => (x || "").replace(/\s+/g, " ").trim();
  return {
    ...c,
    name: s(c.name),
    headline: s(c.headline) || undefined,
    summary: s(c.summary) || undefined,
    skills: (c.skills || []).map((g) => ({ group: s(g.group) || "Skills", items: (g.items || []).map(s).filter(Boolean) })).filter((g) => g.items.length),
    experience: (c.experience || []).map((e) => ({ ...e, title: s(e.title), company: s(e.company), bullets: (e.bullets || []).map(s).filter((b) => b.length > 2) })),
    projects: (c.projects || []).map((p) => ({ ...p, bullets: (p.bullets || []).map(s).filter(Boolean) })),
    education: (c.education || []).map((e) => ({ ...e, degree: s(e.degree), school: s(e.school) })),
    certifications: (c.certifications || []).map(s).filter(Boolean),
    awards: (c.awards || []).map(s).filter(Boolean),
    additional: (c.additional || []).map(s).filter(Boolean),
  };
}

