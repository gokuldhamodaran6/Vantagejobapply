import type { ResumeContent } from "@/lib/types";
import { SKILLS } from "@/lib/ats";
import { lintBullets } from "@/lib/resume/harvard";

/**
 * The recruiter's view of a resume, built only from facts we can check:
 * - what an ATS reads from the file (field by field, from a real render → text → parse round trip),
 * - whether the person shows up when a recruiter searches the skills a role's postings ask for,
 * - how each bullet reads (a result, a clear verb, one or two lines),
 * - the knockout questions asked before anyone reads the resume.
 * No invented "ATS score": every number here is a count of something real.
 */

/* ------------------------------------------------------------------ */
/* What the ATS reads                                                  */
/* ------------------------------------------------------------------ */

export type ParseRow = { field: string; read: string; ok: boolean; note?: string };

const n = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9@.+]/g, "");

/** Compare the resume to what was read back from its own rendered PDF. */
export function parseReadout(src: ResumeContent, read: ResumeContent): ParseRow[] {
  const rows: ParseRow[] = [];
  const same = (a?: string, b?: string) => !!a && n(a) === n(b);
  rows.push({ field: "Name", read: read.name || "Not found", ok: same(src.name, read.name) });
  rows.push({ field: "Email", read: read.email || "Not found", ok: same(src.email, read.email) });
  rows.push({ field: "Phone", read: read.phone || "Not found", ok: !!src.phone && n(src.phone).replace(/\D/g, "") === n(read.phone).replace(/\D/g, "") });
  if (src.location) rows.push({ field: "Location", read: read.location || "Not found", ok: same(src.location, read.location) });

  const full = (src.experience || []).filter((e) => e.title || e.company);
  const got = read.experience || [];
  const titleHits = full.filter((e) => got.some((g) => same(g.title, e.title)));
  const companyHits = full.filter((e) => !e.company || got.some((g) => same(g.company, e.company)));
  const dateHits = full.filter((e) => got.some((g) => same(g.title, e.title) && (g.start || "") === (e.start || "") && (g.end || "") === (e.end || "")));
  const list = (xs: string[]) => xs.slice(0, 3).join("; ") + (xs.length > 3 ? `; +${xs.length - 3}` : "");
  const miss = (xs: typeof full, k: "title" | "company") => full.filter((e) => !xs.includes(e)).map((e) => e[k] || "").filter(Boolean);
  rows.push({ field: "Job titles", read: `${titleHits.length} of ${full.length}: ${list(full.map((e) => e.title))}`, ok: titleHits.length === full.length, note: titleHits.length < full.length ? `Read wrong: ${miss(titleHits, "title").join(", ")}` : undefined });
  rows.push({ field: "Employers", read: `${companyHits.length} of ${full.length}: ${list([...new Set(full.map((e) => e.company).filter(Boolean) as string[])])}`, ok: companyHits.length === full.length, note: companyHits.length < full.length ? `Read wrong: ${miss(companyHits, "company").join(", ")}` : undefined });
  const badDates = full.filter((e) => !e.start && !e.end).length;
  rows.push({ field: "Dates", read: `${dateHits.length} of ${full.length} read with the right role`, ok: dateHits.length === full.length && !badDates, note: badDates ? `${badDates} role${badDates > 1 ? "s have" : " has"} no dates: recruiters filter on years of experience` : undefined });

  const edu = src.education || [];
  const eduHits = edu.filter((e) => (read.education || []).some((g) => same(g.degree, e.degree) || same(g.school, e.school)));
  rows.push({ field: "Education", read: edu.length ? `${eduHits.length} of ${edu.length}: ${edu.map((e) => [e.degree, e.end].filter(Boolean).join(", ")).join("; ")}` : "None listed", ok: edu.length > 0 && eduHits.length === edu.length, note: edu.length ? undefined : "Most postings list a degree requirement; add yours if you have one" });

  const skills = (src.skills || []).flatMap((g) => g.items);
  const readSkills = new Set((read.skills || []).flatMap((g) => g.items).map(n));
  const skillHits = skills.filter((s) => readSkills.has(n(s)));
  rows.push({ field: "Skills", read: `${skillHits.length} of ${skills.length} skills in ${(src.skills || []).length} groups`, ok: skills.length > 0 && skillHits.length >= skills.length * 0.95 });
  rows.push({ field: "Layout", read: "One column, standard section headings, no tables, no text in images", ok: true });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Recruiter search: the skills a role's postings ask for              */
/* ------------------------------------------------------------------ */

/** Terms too generic to search on, or that mean something else in a posting. */
const NOT_SEARCHED = new Set(["communication", "leadership", "cross-functional", "data-driven", "platform", "api", "events", "b2b", "b2c", "pipeline", "operations", "sales", "retention", "partnerships", "discovery", "launch", "messaging", "crm", "rest", "emergency", "teaching", "electrical", "plumbing", "node", "go", "r", "cad", "epic", "platform", "discovery"]);

/** Industry context rather than a skill: shown, but never the headline "missing skill". */
export const DOMAIN = new Set(["supply chain", "procurement", "accounting", "saas", "b2b", "b2c", "logistics", "warehouse", "inventory", "nursing", "patient care", "icu", "auditing", "ifrs", "gaap", "payroll", "compliance", "risk management"]);

/** Ways a resume says the same skill. */
const SAME: Record<string, string[]> = {
  requirements: ["requirements gathering", "requirements", "business requirements", "brd", "functional requirements"],
  "stakeholder management": ["stakeholder", "stakeholders", "senior leadership", "leadership teams"],
  stakeholder: ["stakeholder", "stakeholders", "senior leadership", "leadership teams", "stakeholder reporting"],
  agile: ["agile", "scrum", "agile/scrum", "sprint"],
  scrum: ["scrum", "agile/scrum", "scrum product owner"],
  "google analytics": ["google analytics", "ga4", "google analytics 4"],
  ga4: ["ga4", "google analytics"],
  "a/b testing": ["a/b test", "a/b testing", "experiments", "experimentation"],
  experimentation: ["experiment", "a/b test", "a/b testing"],
  "power bi": ["power bi", "powerbi"],
  excel: ["excel", "spreadsheets"],
  "data visualization": ["dashboards", "data visualization", "power bi", "tableau", "looker"],
  "user stories": ["user stories", "user story"],
  "project management": ["project management", "managed projects", "jira", "asana"],
  "account-based marketing": ["account-based marketing", "abm"],
  abm: ["account-based marketing", "abm"],
  seo: ["seo", "search engine optimization"],
  kpis: ["kpi", "kpis"],
  okrs: ["okr", "okrs"],
  "machine learning": ["machine learning", "ml models", "predictive model"],
  forecasting: ["forecast", "forecasting"],
  "data modeling": ["data model", "data modeling", "metric layer", "semantic layer"],
  etl: ["etl", "data pipeline", "pipelines", "scheduled syncs"],
  "process improvement": ["process improvement", "process mapping", "streamlined", "re-engineered"],
  "product management": ["product management", "product manager", "product owner", "product strategy"],
  "product marketing": ["product marketing", "positioning", "go-to-market"],
  "customer service": ["customer service", "customer support", "client support"],
};

const tokens = (t: string) => ` ${t.toLowerCase().replace(/r&d/g, "rnd").replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ")} `;
const has = (hay: string, term: string) => {
  const t = term.toLowerCase();
  return hay.includes(` ${t} `) || hay.includes(` ${t},`) || hay.includes(` ${t}.`) || hay.includes(` ${t}s `) || hay.includes(` ${t}/`) || hay.includes(` ${t}-`) || hay.includes(` ${t}:`) || hay.includes(` ${t})`) || hay.includes(`(${t} `) || hay.includes(`(${t},`);
};

export type SkillDemand = { skill: string; share: number };

const LABEL: Record<string, string> = { "a/b testing": "A/B testing", "power bi": "Power BI", netsuite: "NetSuite", hubspot: "HubSpot", "google analytics": "Google Analytics", "google ads": "Google Ads", "meta ads": "Meta Ads", "linkedin ads": "LinkedIn Ads", "looker studio": "Looker Studio", "ci/cd": "CI/CD", "node.js": "Node.js", javascript: "JavaScript", typescript: "TypeScript", postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", bigquery: "BigQuery", "scikit-learn": "scikit-learn", "go-to-market": "Go-to-market", "fp&a": "FP&A", "sap s/4hana": "SAP S/4HANA", "c++": "C++", "c#": "C#", ".net": ".NET", graphql: "GraphQL", github: "GitHub" };
const UPPER = new Set(["sql", "seo", "sem", "crm", "abm", "ppc", "api", "etl", "nlp", "llm", "kpis", "okrs", "uat", "aws", "gcp", "cro", "cac", "ltv", "roas", "cpa", "cpl", "ctr", "gtm", "prd", "hris", "saas", "ehr", "ga4", "sap", "vba", "bls", "acls", "dbt", "icu", "ifrs", "gaap", "cdl", "hgv", "cpc", "b2b", "b2c", "ux", "r"]);
/** How a skill is written on a resume: "SQL", "Power BI", "Process improvement". */
export function skillLabel(s: string): string {
  if (LABEL[s]) return LABEL[s];
  if (UPPER.has(s)) return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How many of the postings mention each skill (document frequency), most asked-for first. */
export function skillDemand(postings: string[], max = 12, kind: "skills" | "industry" = "skills"): SkillDemand[] {
  const docs = postings.map(tokens);
  if (!docs.length) return [];
  return SKILLS.filter((s) => !NOT_SEARCHED.has(s) && (kind === "industry") === DOMAIN.has(s))
    .map((skill) => ({ skill, share: Math.round((docs.filter((d) => has(d, skill)).length / docs.length) * 100) }))
    .filter((x) => x.share >= 5)
    .sort((a, b) => b.share - a.share)
    // One entry per idea: "agile" and "scrum", "ga4" and "google analytics" collapse to the most-asked one.
    .filter((x, i, all) => !all.slice(0, i).some((y) => (SAME[y.skill] || []).includes(x.skill) || (SAME[x.skill] || []).includes(y.skill)))
    .slice(0, max);
}

export type SkillProof = { skill: string; share: number; status: "proven" | "listed" | "missing"; where: string[] };

/** For each skill: proven in a bullet (and where), only in the skills list or summary, or missing. */
export function skillProof(c: ResumeContent, demand: SkillDemand[]): SkillProof[] {
  const roleTexts = [
    ...(c.experience || []).filter((e) => !e.brief).map((e) => ({ label: (e.company || e.title).split(",")[0], text: tokens(`${e.title} ${e.bullets.join(" ")}`) })),
    ...(c.projects || []).map((p) => ({ label: p.name.split(/\s+[—–-]\s+/)[0], text: tokens(`${p.name} ${p.tech || ""} ${p.bullets.join(" ")}`) })),
  ];
  const listed = tokens(`${c.headline || ""} ${c.summary || ""} ${(c.skills || []).flatMap((g) => g.items).join(", ")} ${(c.certifications || []).join(", ")}`);
  return demand.map(({ skill, share }) => {
    const forms = [skill, ...(SAME[skill] || [])];
    const where = [...new Set(roleTexts.filter((r) => forms.some((f) => has(r.text, f))).map((r) => r.label))];
    const status = where.length ? "proven" : forms.some((f) => has(listed, f)) ? "listed" : "missing";
    return { skill, share, status, where };
  });
}

/** Does a recruiter's title search find this resume? Title words in a held title, the headline or the summary. */
export function titleFound(c: ResumeContent, role: string): { found: boolean; via: string } {
  const words = role.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["senior", "junior", "lead", "associate", "the", "and"].includes(w));
  const hit = (s?: string) => !!s && words.every((w) => tokens(s).includes(` ${w}`));
  const t = (c.experience || []).find((e) => hit(e.title));
  if (t) return { found: true, via: `your title "${t.title}"` };
  if (hit(c.headline)) return { found: true, via: "your headline" };
  if (hit(c.summary)) return { found: true, via: "your summary" };
  return { found: false, via: "" };
}

/* ------------------------------------------------------------------ */
/* Line by line                                                        */
/* ------------------------------------------------------------------ */

/** A real quantity (a count with a unit, a percentage, money), not a digit inside a name like "A91" or a year. */
const QTY = /(\d[\d,.]*\s?(%|\+|x\b|k\b|m\b|bn\b))|(\$\s?\d)|(\b\d[\d,.]*\s+(?:[a-z-]+\s+){0,2}(hours?|days?|weeks?|months?|years?|accounts?|students?|people|users?|clients?|customers?|brands?|markets?|countries|sources?|cycles?|releases?|videos?|articles?|graphics?|tests?|variants?|marketers?|members?|engineers?|projects?|websites?|sites?|employers?|reports?|dashboards?|campaigns?|stores?|locations?|leads?|files?|comments?|specs?|teams?|units?)\b)|\b(doubled|tripled|halved)\b/i;
const RESULT = /\b(increas|reduc|grew|grow|cut|sav|improv|rais|boost|doubl|tripl|halv|won|promot|contribut\w* to|led to|result|lift|accelerat|drove|generat|deliver\w* \d|launched|shipped|went live|adopted|from \S+ to \S+)/i;

export type LineGrade = {
  section: "experience" | "projects";
  index: number;
  bullet: number;
  role: string;
  /** The employer (or empty for projects). */
  org: string;
  text: string;
  grade: "strong" | "fix";
  tags: { t: string; good: boolean }[];
  tip: string;
};

export function gradeLines(c: ResumeContent): LineGrade[] {
  const issues = lintBullets(c);
  const out: LineGrade[] = [];
  const entries = [
    ...(c.experience || []).map((e, i) => ({ section: "experience" as const, i, role: e.title || e.company, org: e.title ? e.company || "" : "", bullets: e.bullets || [] })),
    ...(c.projects || []).map((p, i) => ({ section: "projects" as const, i, role: p.name.split(/\s+[—–]\s+/)[0], org: "Project", bullets: p.bullets || [] })),
  ];
  for (const e of entries) {
    e.bullets.forEach((b, bi) => {
      const mine = issues.filter((x) => x.section === e.section && x.index === e.i && x.bullet === bi && !x.soft);
      const number = QTY.test(b);
      const result = RESULT.test(b) && (number || /\b(promot|won|award|launched|went live|production)/i.test(b));
      // Scope a hiring manager values on its own: the size of a team led or of what was owned.
      const scope = number && /\b(led|managed|mentored|supervised|owned|ran)\b/i.test(b);
      const tags: { t: string; good: boolean }[] = [];
      if (result) tags.push({ t: "Result", good: true });
      else if (scope) tags.push({ t: "Scope", good: true });
      else tags.push({ t: "No result", good: false });
      if (number && !result && !scope) tags.push({ t: "Has a number", good: true });
      if (/\bcontribut|\bsupport(ed|ing) (a|an|the)\b/i.test(b) && result) tags.push({ t: "Honest credit", good: true });
      if (/\bpromot/i.test(b)) tags.push({ t: "Promotion", good: true });
      for (const x of mine) tags.push({ t: x.kind === "weak" ? "Duty, not achievement" : x.kind === "long" ? "Too long" : x.kind === "verb" ? "Weak opening" : x.kind === "repeat" ? "Repeated verb" : x.kind === "pronoun" ? "Pronoun" : "Full sentences", good: false });
      const tip = mine[0]?.tip || (result ? "Strong line. Keep it near the top of this role." : scope ? "Good scope. If you can, add what the team achieved." : number ? "Say what changed because of it: a before/after, time saved, or who used it." : "Add one real number (how many, how much, how often) or the outcome. Never guess one.");
      out.push({ section: e.section, index: e.i, bullet: bi, role: e.role, org: e.org, text: b, grade: (result || scope) && !mine.length ? "strong" : "fix", tags, tip });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Knockouts                                                           */
/* ------------------------------------------------------------------ */

export type Knockout = { q: string; a: string; set: boolean };
