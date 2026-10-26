/**
 * Role families: how recruiters actually title the same job.
 * A target like "Marketing Specialist" should also surface "Growth Marketing Manager",
 * "Digital Marketing Associate" and "Demand Generation Specialist".
 */

// Words that say what *kind of seat* it is, not what the work is. Interchangeable within a family.
export const SEAT_WORDS = new Set([
  "specialist", "manager", "coordinator", "associate", "executive", "strategist", "officer", "representative", "rep",
  "consultant", "generalist", "administrator", "assistant", "partner", "advisor", "owner", "lead", "analyst",
]);

const NOISE = new Set(["and", "or", "the", "of", "a", "an", "for", "to", "in", "with", "&", "-", "i", "ii", "iii", "iv", "jr", "sr", "senior", "junior", "staff", "principal", "remote", "hybrid", "new", "grad", "entry", "level", "mid"]);

type Family = { match: RegExp; core: string[]; variants: string[] };

export const FAMILIES: Family[] = [
  {
    match: /\bmarketing|growth|seo|sem|demand gen|brand|content market|social media|campaign|performance market|lifecycle|crm market/i,
    core: ["marketing", "growth", "brand", "demand", "content", "seo", "lifecycle", "campaign", "acquisition", "social"],
    variants: ["marketing", "growth marketing", "digital marketing", "performance marketing", "product marketing", "content marketing", "demand generation", "lifecycle marketing", "brand marketing", "marketing operations", "social media", "seo"],
  },
  {
    match: /\bproduct manag|product owner|\bapm\b|\bpm\b/i,
    core: ["product"],
    variants: ["product manager", "associate product manager", "product owner", "technical product manager", "product management", "product operations"],
  },
  {
    match: /\b(software|backend|back-end|frontend|front-end|full[- ]?stack|web|mobile|ios|android) (engineer|developer)|\bswe\b|software develop/i,
    core: ["software", "engineer", "developer", "backend", "frontend", "fullstack", "full", "stack", "web", "mobile", "ios", "android"],
    variants: ["software engineer", "software developer", "backend engineer", "frontend engineer", "full stack engineer", "web developer"],
  },
  {
    match: /\bdata (analyst|scientist|engineer)|analytics|business intelligence|\bbi\b/i,
    core: ["data", "analytics", "analyst", "intelligence", "insights", "bi"],
    variants: ["data analyst", "business analyst", "analytics", "business intelligence", "insights analyst", "data scientist"],
  },
  {
    match: /\bbusiness analyst|operations analyst|strategy|bizops|business operations/i,
    core: ["business", "operations", "strategy", "bizops"],
    variants: ["business analyst", "business operations", "strategy and operations", "operations analyst", "strategy analyst"],
  },
  {
    match: /\b(ux|ui|product|visual|graphic) designer|design/i,
    core: ["design", "designer", "ux", "ui", "visual", "graphic"],
    variants: ["product designer", "ux designer", "ui designer", "visual designer", "graphic designer"],
  },
  {
    match: /\bsales|account executive|business development|\bsdr\b|\bbdr\b|account manager/i,
    core: ["sales", "account", "business", "development", "revenue"],
    variants: ["account executive", "sales development", "business development", "account manager", "sales"],
  },
  {
    match: /\bcustomer success|customer support|customer experience|support specialist/i,
    core: ["customer", "success", "support", "experience"],
    variants: ["customer success", "customer support", "customer experience", "support specialist"],
  },
  {
    match: /\b(truck|hgv|lgv|cdl|delivery|lorry) driver|driver/i,
    core: ["driver", "truck", "hgv", "lgv", "cdl", "lorry", "delivery", "haulage"],
    variants: ["truck driver", "hgv driver", "cdl driver", "delivery driver", "class a driver"],
  },
  {
    match: /\bnurse|nursing|\brn\b/i,
    core: ["nurse", "nursing", "rn"],
    variants: ["registered nurse", "staff nurse", "nurse"],
  },
  {
    match: /\bproject manag|program manag|\bpmo\b/i,
    core: ["project", "program", "delivery"],
    variants: ["project manager", "program manager", "project coordinator", "technical program manager"],
  },
  {
    match: /\bfinanc|accountant|accounting|fp&a/i,
    core: ["finance", "financial", "accounting", "accountant", "fp&a"],
    variants: ["financial analyst", "accountant", "fp&a", "finance associate"],
  },
  {
    match: /\brecruit|talent acquisition|\bhr\b|people operations|human resources/i,
    core: ["recruiter", "recruiting", "talent", "people", "hr"],
    variants: ["recruiter", "talent acquisition", "people operations", "hr generalist"],
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

/** Search phrases for a target role: the title itself, then its family's common titles. */
export function searchVariants(title: string, max = 8): string[] {
  const out = [title.trim()];
  const fam = familyOf(title);
  if (fam) out.push(...fam.variants);
  const swaps: [RegExp, string][] = [[/\bengineer\b/i, "developer"], [/\bdeveloper\b/i, "engineer"], [/\banalyst\b/i, "analytics"]];
  for (const [re, rep] of swaps) if (re.test(title)) out.push(title.replace(re, rep));
  return [...new Set(out.map((t) => t.toLowerCase().trim()))].slice(0, max);
}

/**
 * 0..1 similarity between a target role and a job title.
 * Domain words (marketing, product, data…) carry most of the weight; seat words (manager, specialist…)
 * are interchangeable, so "Marketing Specialist" ≈ "Growth Marketing Manager".
 */
export function roleSimilarity(roleTitle: string, jobTitle: string): number {
  const r = tokens(roleTitle);
  const j = new Set(tokens(jobTitle));
  if (!r.length || !j.size) return 0;
  const domain = r.filter((t) => !SEAT_WORDS.has(t));
  const seats = r.filter((t) => SEAT_WORDS.has(t));
  const fam = familyOf(roleTitle);
  const famCore = new Set(fam?.core || []);
  const jobInFamily = fam ? fam.match.test(jobTitle) || [...j].some((t) => famCore.has(t)) : false;

  let dom = 0;
  if (domain.length) {
    const hits = domain.filter((t) => j.has(t)).length;
    dom = hits / domain.length;
    if (dom < 1 && jobInFamily) dom = Math.max(dom, 0.7);
  } else dom = jobInFamily ? 0.8 : 0;

  let seat = 0.5;
  if (seats.length) seat = seats.some((t) => j.has(t)) ? 1 : [...j].some((t) => SEAT_WORDS.has(t)) ? 0.6 : 0.3;

  const exact = jobTitle.toLowerCase().includes(roleTitle.toLowerCase().trim()) ? 0.15 : 0;
  // Product manager needs "product" AND a manager/owner seat; otherwise "Product Designer" would match.
  if (fam && /product manag|product owner/i.test(roleTitle) && !/\b(manager|owner|management|pm|apm)\b/i.test(jobTitle)) return Math.min(0.35, dom * 0.4);
  return Math.min(1, dom * 0.78 + seat * 0.22 + exact);
}
