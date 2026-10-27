/**
 * Role families: how recruiters actually title the same job.
 * A target like "Marketing Specialist" should also surface "Growth Marketing Manager",
 * "Digital Marketing Associate" and "Demand Generation Specialist" — but a "Business Analyst"
 * target must never surface "Marketing Operations Analyst" or "Business Development Manager".
 */

// Words that say what *kind of seat* it is, not what the work is. Interchangeable within a family.
// ("analyst" is deliberately not here: an analyst seat is a different job from a manager or specialist seat.)
export const SEAT_WORDS = new Set([
  "specialist", "manager", "coordinator", "associate", "executive", "strategist", "officer", "representative", "rep",
  "consultant", "generalist", "administrator", "assistant", "partner", "advisor", "owner", "lead",
]);

// Generic head nouns: they say what kind of work, but on their own ("Security Analyst" vs "Business Analyst")
// they carry little of the meaning. They count, at a fraction of a domain word's weight.
const HEAD_NOUNS = new Set(["analyst", "engineer", "developer", "designer", "scientist", "architect"]);
const HEAD_WEIGHT = 0.35;

const NOISE = new Set(["and", "or", "the", "of", "a", "an", "for", "to", "in", "with", "&", "-", "i", "ii", "iii", "iv", "jr", "sr", "senior", "junior", "staff", "principal", "remote", "hybrid", "new", "grad", "entry", "level", "mid"]);

export type Family = {
  id: string;
  match: RegExp;
  core: string[];
  variants: string[];
  /** Families whose titles are reasonable alternatives (a Business Analyst target may see Data Analyst roles). */
  related?: string[];
  /** A cross-cutting family (e.g. "operations analyst") that never makes a title belong to another discipline. */
  generic?: boolean;
};

export const FAMILIES: Family[] = [
  {
    id: "marketing",
    match: /\b(marketing|growth market|seo|sem|demand gen|brand|content market|social media|campaign|performance market|lifecycle market|crm market)/i,
    core: ["marketing", "growth", "brand", "demand", "content", "seo", "lifecycle", "campaign", "acquisition", "social"],
    variants: ["marketing", "growth marketing", "digital marketing", "performance marketing", "product marketing", "content marketing", "demand generation", "lifecycle marketing", "brand marketing", "marketing operations", "social media", "seo"],
  },
  {
    id: "product",
    match: /\bproduct manag|product owner|\bapm\b|\bpm\b/i,
    core: ["product"],
    variants: ["product manager", "associate product manager", "product owner", "technical product manager", "product management", "product operations"],
  },
  {
    id: "software",
    match: /\b(software|backend|back-end|frontend|front-end|full[- ]?stack|web|mobile|ios|android) (engineer|developer)|\bswe\b|software develop/i,
    core: ["software", "engineer", "developer", "backend", "frontend", "fullstack", "full", "stack", "web", "mobile", "ios", "android"],
    variants: ["software engineer", "software developer", "backend engineer", "frontend engineer", "full stack engineer", "web developer"],
  },
  {
    id: "data",
    match: /\bdata (analyst|scientist|engineer)|\banalytics\b|business intelligence|\bbi\b/i,
    core: ["data", "analytics", "intelligence", "insights", "bi"],
    variants: ["data analyst", "business analyst", "analytics", "business intelligence", "insights analyst", "data scientist"],
    related: ["business_analysis"],
  },
  {
    id: "business_analysis",
    match: /\bbusiness analy|\b(business )?systems analyst|\boperations analyst|strategy (and|&) operations|\bstrategy analyst|\bbizops\b|business operations/i,
    core: ["bizops"],
    variants: ["business analyst", "business systems analyst", "business operations", "strategy and operations", "operations analyst", "strategy analyst"],
    related: ["data"],
    generic: true,
  },
  {
    id: "design",
    match: /\b(ux|ui|product|visual|graphic) designer|\bdesign(er)?\b/i,
    core: ["design", "designer", "ux", "ui", "visual", "graphic"],
    variants: ["product designer", "ux designer", "ui designer", "visual designer", "graphic designer"],
  },
  {
    id: "sales",
    match: /\bsales\b|account executive|business development|\bsdr\b|\bbdr\b|account manager/i,
    core: ["sales", "account", "development", "revenue"],
    variants: ["account executive", "sales development", "business development", "account manager", "sales"],
  },
  {
    id: "customer",
    match: /\bcustomer success|customer support|customer experience|support specialist/i,
    core: ["customer", "success", "support", "experience"],
    variants: ["customer success", "customer support", "customer experience", "support specialist"],
  },
  {
    id: "driver",
    match: /\b(truck|hgv|lgv|cdl|delivery|lorry) driver|\bdriver\b/i,
    core: ["driver", "truck", "hgv", "lgv", "cdl", "lorry", "delivery", "haulage"],
    variants: ["truck driver", "hgv driver", "cdl driver", "delivery driver", "class a driver"],
  },
  {
    id: "nursing",
    match: /\bnurse|nursing|\brn\b/i,
    core: ["nurse", "nursing", "rn"],
    variants: ["registered nurse", "staff nurse", "nurse"],
  },
  {
    id: "project",
    match: /\bproject manag|program manag|\bpmo\b/i,
    core: ["project", "program", "delivery"],
    variants: ["project manager", "program manager", "project coordinator", "technical program manager"],
  },
  {
    id: "finance",
    match: /\bfinanc|accountant|accounting|fp&a|\btreasury\b/i,
    core: ["finance", "financial", "accounting", "accountant", "fp&a"],
    variants: ["financial analyst", "accountant", "fp&a", "finance associate"],
  },
  {
    id: "people",
    match: /\brecruit|talent acquisition|\bhr\b|people operations|human resources/i,
    core: ["recruiter", "recruiting", "talent", "hr"],
    variants: ["recruiter", "talent acquisition", "people operations", "hr generalist"],
  },
  {
    id: "it_security",
    match: /\b(security|network|cyber|it|noc|soc|infrastructure) operations\b|\bsecurity analyst|\bcyber|\bsoc analyst|\bnetwork (analyst|engineer|administrator)/i,
    core: ["security", "cyber", "network", "soc", "noc"],
    variants: ["security analyst", "security operations", "network operations", "cyber security analyst"],
  },
];

export function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#&. ]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t && !NOISE.has(t));
}

export function familyOf(title: string): Family | undefined {
  return FAMILIES.find((f) => f.match.test(title));
}

/** Every family a title belongs to ("Marketing Operations Analyst" is marketing and operations-analyst). */
export function familiesOf(title: string): Family[] {
  return FAMILIES.filter((f) => f.match.test(title));
}

/** Search phrases for a target role: the title itself, then its family's common titles. */
export function searchVariants(title: string, max = 8): string[] {
  const out = [title.trim()];
  const fam = familyOf(title);
  if (fam) out.push(...fam.variants);
  const swaps: [RegExp, string][] = [[/\bengineer\b/i, "developer"], [/\bdeveloper\b/i, "engineer"], [/\banalyst\b/i, "analytics"]];
  for (const [re, rep] of swaps) if (re.test(title)) out.push(title.replace(re, rep));
  return [...new Set(out.map((t) => t.toLowerCase().trim()))].slice(0, max);
}

/** Does the job title contain the role title as a phrase ("Business Analyst – Marketing" contains "Business Analyst")? */
function containsPhrase(roleTitle: string, jobTitle: string) {
  const r = tokens(roleTitle).join(" ");
  return Boolean(r) && ` ${tokens(jobTitle).join(" ")} `.includes(` ${r} `);
}

/**
 * 0..1 similarity between a target role and a job title.
 * Domain words (marketing, product, data…) carry most of the weight; seat words (manager, specialist…)
 * are interchangeable, so "Marketing Specialist" ≈ "Growth Marketing Manager".
 * A title that belongs to a different discipline ("Marketing Operations Analyst" for a Business Analyst)
 * is capped well below any "fits your target" threshold, unless it literally contains the role's title.
 */
export function roleSimilarity(roleTitle: string, jobTitle: string): number {
  const r = tokens(roleTitle);
  const j = new Set(tokens(jobTitle));
  if (!r.length || !j.size) return 0;
  const domain = r.filter((t) => !SEAT_WORDS.has(t));
  const seats = r.filter((t) => SEAT_WORDS.has(t));
  const roleFams = familiesOf(roleTitle);
  const fam = roleFams[0];
  const jobFams = familiesOf(jobTitle);
  const exactPhrase = containsPhrase(roleTitle, jobTitle);

  // Same family, a related family, or (for titles no family knows) a shared core word.
  const own = new Set(roleFams.map((f) => f.id));
  const related = new Set(roleFams.flatMap((f) => f.related || []));
  const famCore = new Set(fam?.core || []);
  const inFamily = jobFams.some((f) => own.has(f.id));
  const inRelated = !inFamily && jobFams.some((f) => related.has(f.id));
  const coreOnly = !inFamily && !inRelated && !jobFams.length && [...j].some((t) => famCore.has(t));
  // Another discipline: the job belongs to a family that isn't the role's own or a related one.
  const foreign = jobFams.some((f) => !f.generic && !own.has(f.id) && !related.has(f.id));

  let dom = 0;
  if (domain.length) {
    const weight = (t: string) => (HEAD_NOUNS.has(t) ? HEAD_WEIGHT : 1);
    const total = domain.reduce((a, t) => a + weight(t), 0);
    const hits = domain.filter((t) => j.has(t)).reduce((a, t) => a + weight(t), 0);
    dom = hits / total;
    if (dom < 1 && inFamily) dom = Math.max(dom, 0.7);
    else if (dom < 1 && inRelated) dom = Math.max(dom, 0.6);
    else if (dom < 1 && coreOnly) dom = Math.max(dom, 0.55);
  } else dom = inFamily ? 0.8 : inRelated ? 0.6 : coreOnly ? 0.55 : 0;

  let seat = 0.5;
  if (seats.length) seat = seats.some((t) => j.has(t)) ? 1 : [...j].some((t) => SEAT_WORDS.has(t)) ? 0.6 : 0.3;

  const exact = exactPhrase ? 0.15 : 0;
  // Product manager needs "product" AND a manager/owner seat; otherwise "Product Designer" would match.
  if (fam?.id === "product" && /product manag|product owner/i.test(roleTitle) && !/\b(manager|owner|management|pm|apm)\b/i.test(jobTitle)) return Math.min(0.35, dom * 0.4);
  // "Product Marketing Manager" is a marketing job, not a Product Manager one (and "Product Designer" a design job):
  // a compound discipline in the job title that the role doesn't have is a different job.
  const COMPOUND = /\bproduct (marketing|design|designer|analyst|analytics|support|operations|ops|counsel|engineer(ing)?)\b/i;
  const jc = jobTitle.match(COMPOUND)?.[0]?.toLowerCase();
  if (jc && /product (manag|owner)/i.test(roleTitle) && !roleTitle.toLowerCase().includes(jc.split(" ")[1])) return Math.min(0.4, dom * 0.5);
  const sim = Math.min(1, dom * 0.78 + seat * 0.22 + exact);
  if (foreign && !exactPhrase) return Math.min(sim, 0.3);
  return sim;
}
