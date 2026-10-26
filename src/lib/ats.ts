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
  const checks = [
    { ok: Boolean(c.email && (c.phone || c.location)), title: "Contact details", detail: c.email ? "Email and location or phone are present" : "Add your email and phone or city" },
    ...SECTION_CHECKS.map((s) => ({ ok: has[s], title: `${s[0].toUpperCase()}${s.slice(1)} section`, detail: has[s] ? "Present with a standard heading" : `Add a ${s} section` })),
    { ok: bullets.length >= 4, title: "Bullet points", detail: `${bullets.length} bullet points across your experience` },
    { ok: bullets.length === 0 || quantified / bullets.length >= 0.5, title: "Measurable results", detail: `${quantified} of ${bullets.length} bullets include a number` },
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

/* ---------- Plain-text resume → structured content (no AI needed) ---------- */
const HEADINGS: [RegExp, keyof ResumeContent | "ignore"][] = [
  [/^(professional )?(summary|profile|objective|about me)\b/i, "summary"],
  [/^(technical |core |key )?skills|^technologies|^competencies/i, "skills"],
  [/^(work |professional |employment )?(experience|history)\b/i, "experience"],
  [/^projects?\b/i, "projects"],
  [/^education\b|^academic/i, "education"],
  [/^certifications?|^licen[cs]es/i, "certifications"],
];

export function parseResumeText(raw: string, fallbackName = ""): ResumeContent {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const phone = raw.match(/\+?\d[\d\s().-]{8,}\d/)?.[0];
  const links = raw.match(/(https?:\/\/)?(www\.)?(linkedin\.com|github\.com)\/[^\s,|]+/gi) || [];
  const c: ResumeContent = { name: fallbackName || lines[0] || "", email, phone, links, skills: [], experience: [], projects: [], education: [], certifications: [] };

  let section: keyof ResumeContent | "ignore" | null = null;
  const summary: string[] = [];
  for (const line of lines.slice(1)) {
    const heading = line.length < 40 ? HEADINGS.find(([re]) => re.test(line.replace(/[:•\-–]/g, "").trim())) : undefined;
    if (heading) {
      section = heading[1];
      continue;
    }
    const isBullet = /^[•\-*–▪●◦]\s*/.test(line);
    const text = line.replace(/^[•\-*–▪●◦]\s*/, "");
    if (section === "summary" || section === null) {
      if (!email || !line.includes(email)) summary.push(text);
    } else if (section === "skills") {
      const [group, rest] = text.includes(":") ? [text.split(":")[0], text.split(":").slice(1).join(":")] : ["Skills", text];
      c.skills!.push({ group: group.trim(), items: rest.split(/[,|;•]/).map((s) => s.trim()).filter(Boolean) });
    } else if (section === "experience") {
      if (isBullet && c.experience!.length) c.experience![c.experience!.length - 1].bullets.push(text);
      else if (!isBullet) {
        const dates = text.match(/((\w{3,9}\.? )?\d{4})\s*[-–to]+\s*((\w{3,9}\.? )?\d{4}|present|current|now)/i);
        const head = dates ? text.replace(dates[0], "").replace(/[|,–-]\s*$/, "").trim() : text;
        const [title, company] = head.split(/\s+[|@–—-]\s+|,\s+| at /i);
        if (dates || !c.experience!.length || c.experience![c.experience!.length - 1].bullets.length) {
          c.experience!.push({ title: (title || head).trim(), company: (company || "").trim(), start: dates?.[1], end: dates?.[3], bullets: [] });
        } else c.experience![c.experience!.length - 1].bullets.push(text);
      }
    } else if (section === "projects") {
      if (isBullet && c.projects!.length) c.projects![c.projects!.length - 1].bullets.push(text);
      else c.projects!.push({ name: text, bullets: [] });
    } else if (section === "education") {
      const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
      const [degree, school] = text.split(/\s+[|–—-]\s+|,\s+/);
      c.education!.push({ degree: (degree || text).trim(), school: (school || "").trim(), end: year });
    } else if (section === "certifications") {
      c.certifications!.push(text);
    }
  }
  c.summary = summary.join(" ").slice(0, 900);
  return c;
}
