import type { ResumeContent } from "@/lib/types";

// Common hard skills across fields; used to pull keywords from postings.
const SKILLS = [
  "sql", "python", "java", "javascript", "typescript", "react", "node.js", "node", "go", "golang", "rust", "c++", "c#", ".net", "ruby", "php", "kotlin", "swift",
  "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "terraform", "linux", "git", "ci/cd", "rest", "graphql", "microservices",
  "postgresql", "mysql", "mongodb", "redis", "snowflake", "bigquery", "dbt", "airflow", "spark", "kafka", "hadoop", "databricks",
  "tableau", "power bi", "looker", "excel", "r", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "machine learning", "deep learning",
  "statistics", "a/b testing", "data modeling", "etl", "data visualization", "nlp", "llm", "computer vision",
  "figma", "ux research", "prototyping", "agile", "scrum", "jira", "product management", "roadmap", "stakeholder management",
  "salesforce", "hubspot", "seo", "sem", "google analytics", "content marketing", "crm",
  "accounting", "ifrs", "gaap", "financial modeling", "auditing", "budgeting", "forecasting", "sap", "quickbooks",
  "autocad", "solidworks", "matlab", "cad", "revit", "project management", "six sigma", "lean",
  "patient care", "nursing", "icu", "emergency", "medication administration", "ehr", "epic", "bls", "acls", "nmc", "nclex",
  "hgv", "class 1", "class 2", "cdl", "tachograph", "cpc", "forklift", "logistics", "warehouse", "route planning",
  "customer service", "sales", "negotiation", "communication", "leadership", "teaching", "curriculum", "electrical", "plumbing",
  // Marketing & growth
  "marketing automation", "demand generation", "lifecycle marketing", "email marketing", "paid social", "paid search", "paid media", "ppc",
  "google ads", "meta ads", "linkedin ads", "facebook ads", "tiktok ads", "programmatic", "marketo", "braze", "iterable", "klaviyo", "mailchimp",
  "salesforce marketing cloud", "pardot", "amplitude", "mixpanel", "segment", "ga4", "google analytics 4", "google tag manager", "looker studio",
  "attribution", "cac", "ltv", "roas", "cpa", "cpl", "ctr", "conversion rate optimization", "cro", "landing pages", "copywriting", "brand marketing",
  "content strategy", "social media", "influencer marketing", "partnerships", "go-to-market", "gtm", "product marketing", "positioning", "messaging",
  "market research", "competitive analysis", "customer segmentation", "account-based marketing", "abm", "lead generation", "pipeline", "b2b", "b2c",
  "saas", "events", "webinars", "public relations", "communications", "canva", "adobe creative suite", "photoshop", "illustrator", "premiere pro",
  "video editing", "wordpress", "webflow", "semrush", "ahrefs", "keyword research", "technical seo", "growth marketing", "performance marketing",
  "campaign management", "budget management", "marketing analytics", "brand strategy", "community management", "newsletter", "crm",
  // Product
  "product strategy", "user research", "customer discovery", "prd", "requirements", "prioritization", "okrs", "kpis", "experimentation",
  "roadmapping", "cross-functional", "user stories", "backlog", "discovery", "product launch", "pricing", "product analytics", "confluence",
  "wireframes", "usability testing", "customer journey", "stakeholder", "data-driven", "api", "platform",
  // Business, ops, finance, people
  "operations", "process improvement", "vendor management", "supply chain", "procurement", "inventory", "fp&a", "variance analysis",
  "power query", "vba", "sap s/4hana", "netsuite", "workday", "recruiting", "sourcing", "onboarding", "hris", "payroll", "compliance", "risk management",
  "customer success", "account management", "retention", "churn", "upselling", "cold outreach", "salesforce crm", "zendesk", "intercom",
];

const SECTION_CHECKS = ["summary", "skills", "experience", "education"] as const;

export function extractKeywords(text: string, max = 25): string[] {
  const t = ` ${(text || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ")} `;
  const found = SKILLS.filter((s) => t.includes(` ${s} `) || t.includes(` ${s},`) || t.includes(` ${s}.`));
  // Rank by frequency in the posting.
  const freq = (s: string) => t.split(` ${s}`).length - 1;
  return [...new Set(found)].sort((a, b) => freq(b) - freq(a)).slice(0, max);
}

export function resumeText(c: ResumeContent): string {
  return [
    c.name, c.headline, c.summary,
    ...(c.skills || []).flatMap((g) => [g.group, ...g.items]),
    ...(c.experience || []).flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...(c.projects || []).flatMap((p) => [p.name, p.tech || "", ...p.bullets]),
    ...(c.education || []).flatMap((e) => [e.degree, e.school, e.details || ""]),
    ...(c.certifications || []),
    ...(c.awards || []),
    ...(c.additional || []),
  ].filter(Boolean).join(" \n ");
}

export type AtsReport = {
  score: number;
  matched: string[];
  missing: string[];
  checks: { ok: boolean; title: string; detail: string }[];
};

export function scoreResume(c: ResumeContent, targetKeywords: string[] = []): AtsReport {
  const text = ` ${resumeText(c).toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ")} `;
  const matched = targetKeywords.filter((k) => text.includes(` ${k.toLowerCase()} `) || text.includes(` ${k.toLowerCase()}`));
  const missing = targetKeywords.filter((k) => !matched.includes(k));
  const bullets = (c.experience || []).flatMap((e) => e.bullets).concat((c.projects || []).flatMap((p) => p.bullets));
  const quantified = bullets.filter((b) => /\d/.test(b)).length;
  const words = resumeText(c).split(/\s+/).length;

  const has = {
    summary: Boolean(c.summary && c.summary.length > 40),
    skills: Boolean(c.skills?.some((g) => g.items.length)),
    experience: Boolean(c.experience?.length),
    education: Boolean(c.education?.length),
  };
  const pronouns = bullets.filter((b) => /\b(i|me|my|we|our)\b/i.test(b)).length;
  const weak = bullets.filter((b) => /^(responsible for|duties included|worked on|helped|assisted with|tasked with)\b/i.test(b.trim())).length;
  const checks = [
    { ok: Boolean(c.email && (c.phone || c.location)), title: "Contact details", detail: c.email ? "Email and location or phone are present" : "Add your email and phone or city" },
    ...SECTION_CHECKS.map((s) => ({ ok: has[s], title: `${s[0].toUpperCase()}${s.slice(1)} section`, detail: has[s] ? "Present with a standard heading" : `Add a ${s} section` })),
    { ok: bullets.length >= 4, title: "Bullet points", detail: `${bullets.length} bullet points across your experience` },
    { ok: bullets.length === 0 || quantified / bullets.length >= 0.5, title: "Measurable results", detail: `${quantified} of ${bullets.length} bullets include a number` },
    { ok: pronouns === 0, title: "No first-person words", detail: pronouns ? `${pronouns} bullet${pronouns > 1 ? "s use" : " uses"} I/my/we — recruiters expect implied first person` : "Bullets use implied first person" },
    { ok: weak === 0, title: "Strong opening verbs", detail: weak ? `${weak} bullet${weak > 1 ? "s start" : " starts"} with weak phrases like “Responsible for”` : "Bullets open with action verbs" },
    { ok: words >= 200 && words <= 900, title: "Length", detail: words < 200 ? "A bit short — add detail to your experience" : words > 900 ? "Long — trim to the most relevant points" : `${words} words — a good length` },
  ];
  if (targetKeywords.length) {
    checks.push({ ok: matched.length / targetKeywords.length >= 0.6, title: "Keywords for your target role", detail: `${matched.length} of ${targetKeywords.length} common keywords appear` });
  }

  const structure = checks.filter((x) => x.ok).length / checks.length;
  const coverage = targetKeywords.length ? matched.length / targetKeywords.length : structure;
  const score = Math.round(structure * 55 + coverage * 45);
  return { score: Math.max(0, Math.min(100, score)), matched, missing, checks };
}

export { parseResumeText } from "@/lib/resume/parse";
