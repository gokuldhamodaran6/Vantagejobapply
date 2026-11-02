/**
 * What specific employers say they look for, so the writer frames the candidate's REAL evidence in each company's
 * language. Sources: each company's own careers/hiring pages (Google "How we hire", Amazon Leadership Principles,
 * Meta, Microsoft, Netflix culture memo, Salesforce values) and the big consulting firms' recruiting guides.
 * A playbook never adds facts; it only decides emphasis, wording and what to lead with.
 */

export type CompanyKind = "bigtech" | "enterprise" | "consulting" | "finance" | "startup" | "public" | "agency" | "other";

export type Playbook = {
  key: string;
  name: string;
  kind: CompanyKind;
  /** What the company says it hires for, in its own words. */
  values: string[];
  /** How to frame evidence on the resume for this company. */
  resume: string;
  /** Cover-letter guidance (some companies barely read them). */
  letter: string;
};

const BIG: Playbook[] = [
  {
    key: "google", name: "Google", kind: "bigtech",
    values: ["general cognitive ability (how you solve hard, ambiguous problems)", "role-related knowledge", "emergent leadership (stepping up without the title)", "Googleyness: comfort with ambiguity, bias to action, collaboration, user focus"],
    resume: "Every bullet in Google's own X-Y-Z shape: 'Accomplished [X] as measured by [Y] by doing [Z]'. Lead with scale and measurable impact; show data-driven decisions and problems solved with ambiguity. One page under ~10 years of experience. Plain, specific language; no buzzwords.",
    letter: "Google's application rarely asks for a letter; if it does, keep it short: one sharp product or user insight and two quantified proofs.",
  },
  {
    key: "meta", name: "Meta", kind: "bigtech",
    values: ["Move fast", "Build awesome things", "Focus on long-term impact", "Live in the future", "Be direct and respect your colleagues", "Meta, Metamates, me"],
    resume: "Impact first: what shipped, how fast, how many people it reached, and the metric that moved. Show ownership end to end, speed of iteration (release cycles, experiments) and data-driven product decisions. Concise bullets with numbers.",
    letter: "Rarely read for most roles. If included: direct, short, impact-focused; name a Meta product or problem and a measurable result.",
  },
  {
    key: "amazon", name: "Amazon", kind: "bigtech",
    values: ["Customer Obsession", "Ownership", "Invent and Simplify", "Are Right, A Lot", "Learn and Be Curious", "Hire and Develop the Best", "Insist on the Highest Standards", "Think Big", "Bias for Action", "Frugality", "Earn Trust", "Dive Deep", "Have Backbone; Disagree and Commit", "Deliver Results", "Strive to be Earth's Best Employer", "Success and Scale Bring Broad Responsibility"],
    resume: "Map the strongest bullets to Leadership Principles without naming them: customer outcome (Customer Obsession), end-to-end ownership, diving deep into data, delivering measurable results, simplifying a process. Metrics in nearly every bullet; data-backed, no fluff.",
    letter: "Amazon rarely needs one. If asked: two STAR-style proofs tied to the posting's 'Basic' and 'Preferred' qualifications.",
  },
  {
    key: "microsoft", name: "Microsoft", kind: "bigtech",
    values: ["growth mindset", "customer obsessed", "diverse and inclusive", "One Microsoft (collaboration across teams)", "making a difference", "create clarity, generate energy, deliver success"],
    resume: "Show learning and growth (new domains mastered), cross-team collaboration, customer impact and measurable delivery. Use the posting's exact qualification phrases.",
    letter: "Optional; when used, show growth mindset with one concrete learning-to-impact story.",
  },
  {
    key: "apple", name: "Apple", kind: "bigtech",
    values: ["craftsmanship and attention to detail", "deep expertise", "cross-functional collaboration", "user privacy and quality"],
    resume: "Precise, elegant and minimal. Fewer, stronger bullets that show quality, depth and finished work; avoid hype words.",
    letter: "Short and specific about the product area; no superlatives.",
  },
  {
    key: "netflix", name: "Netflix", kind: "bigtech",
    values: ["judgment", "candor", "courage", "selflessness", "inclusion", "high performance", "freedom and responsibility", "context, not control"],
    resume: "Senior-sounding ownership: decisions made with context, outcomes delivered independently, candour about trade-offs. Lean, high-signal bullets.",
    letter: "Rarely needed; if used, concise and direct.",
  },
  {
    key: "salesforce", name: "Salesforce", kind: "enterprise",
    values: ["Trust", "Customer Success", "Innovation", "Equality", "Sustainability"],
    resume: "Customer-success outcomes, CRM/data fluency, trusted delivery for enterprise stakeholders.",
    letter: "Tie one customer-success story to the role.",
  },
];

const FIRMS: Record<string, string> = {
  deloitte: "Deloitte", pwc: "PwC", "ernst young": "EY", ey: "EY", kpmg: "KPMG", accenture: "Accenture", mckinsey: "McKinsey", bcg: "BCG",
  "boston consulting": "BCG", bain: "Bain", capgemini: "Capgemini", "booz allen": "Booz Allen", ibm: "IBM Consulting",
};
const FINANCE = /\b(bank|capital|financial|securities|asset management|insurance|jpmorgan|jp morgan|goldman|morgan stanley|citi|wells fargo|bank of america|barclays|hsbc|blackrock|fidelity|vanguard|state farm|allstate|american express|amex|visa|mastercard|discover|capital one)\b/i;
const ENTERPRISE = /\b(oracle|sap|workday|servicenow|adobe|cisco|intel|ibm|dell|hp|hewlett|vmware|broadcom|siemens|ge |general electric|caterpillar|john deere|deere|boeing|lockheed|3m|procter|p&g|unilever|nestle|pepsico|coca-cola|walmart|target|kroger|costco|home depot|johnson & johnson|pfizer|abbvie|cvs|unitedhealth|anthem|humana|cardinal|mckesson|at&t|verizon|t-mobile|comcast|disney|nike|ford|gm|general motors|tesla|uber|lyft|airbnb|linkedin|intuit|paypal|ebay|nvidia|qualcomm|amd)\b/i;
const PUBLIC = /\b(university|college|state of|county|city of|department of|federal|government|ministry|council|nhs|agency|school district|public)\b/i;

const KIND: Record<CompanyKind, Omit<Playbook, "key" | "name" | "kind">> = {
  bigtech: {
    values: ["impact at scale", "data-driven decisions", "ownership", "speed of execution"],
    resume: "X-Y-Z bullets with measurable impact and scale; lead with shipped work and metrics.",
    letter: "Short and specific; often optional.",
  },
  enterprise: {
    values: ["reliable delivery", "stakeholder management", "cross-functional collaboration", "measurable business outcomes", "process and governance"],
    resume: "Show business outcomes, stakeholder scope (leadership, clients, regions), process improvement, governance and the exact tools in the posting. Mirror qualification phrases exactly for the ATS (Workday/Taleo/SuccessFactors).",
    letter: "Read more often than at big tech: connect two proofs to the posting's responsibilities and show you understand the business.",
  },
  consulting: {
    values: ["structured problem solving", "client impact", "leadership", "teamwork", "communication"],
    resume: "One page, achievement-led, quantified client or business impact; show leadership and problem framing; education prominent for MBA candidates.",
    letter: "Usually expected: why this firm (practice, office, people met), why consulting, two proofs of problem solving and leadership.",
  },
  finance: {
    values: ["accuracy and rigour", "risk and control awareness", "analytical depth", "client focus", "integrity"],
    resume: "Precision: numbers, scale, analytical tools, controls and compliance-minded delivery; conservative formatting.",
    letter: "Formal tone; show understanding of the business line and rigour.",
  },
  startup: {
    values: ["ownership", "speed", "breadth across functions", "bias for action", "comfort with ambiguity"],
    resume: "Lead with things built and shipped end to end, speed, breadth and scrappy results; founder or zero-to-one work is a major asset.",
    letter: "Personal and specific: why this product, what you'd tackle first.",
  },
  public: {
    values: ["mission and service", "stakeholder communication", "compliance with requirements", "reliability"],
    resume: "Address every listed qualification explicitly with clear evidence; plain language; complete dates.",
    letter: "Often required: address the selection criteria directly.",
  },
  agency: {
    values: ["client results", "creativity with measurable outcomes", "speed", "account growth"],
    resume: "Client outcomes, campaign metrics, channels and tools.",
    letter: "Show client-results thinking and fit with the agency's clients.",
  },
  other: {
    values: ["measurable outcomes", "relevant skills", "collaboration"],
    resume: "Achievement-led bullets mirroring the posting's language.",
    letter: "Specific reason for this company and two quantified proofs.",
  },
};

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim()} `;

/** The playbook for a company: a named one when we have it, otherwise the one for its kind. */
export function playbookFor(company: string, hint?: CompanyKind | null): Playbook {
  const n = norm(company || "");
  const named = BIG.find((p) => n.includes(` ${p.key} `) || (p.key === "google" && /\b(alphabet|youtube|deepmind)\b/.test(n)) || (p.key === "meta" && /\b(facebook|instagram|whatsapp)\b/.test(n)) || (p.key === "amazon" && /\b(aws|amazon web services)\b/.test(n)));
  if (named) return named;
  const firm = Object.keys(FIRMS).find((k) => n.includes(` ${k} `));
  const kind: CompanyKind = firm ? "consulting" : FINANCE.test(company) ? "finance" : ENTERPRISE.test(company) ? "enterprise" : PUBLIC.test(company) ? "public" : hint || "other";
  return { key: kind, name: firm ? FIRMS[firm] : company, kind, ...KIND[kind] };
}

export function playbookPrompt(p: Playbook): string {
  return `EMPLOYER PLAYBOOK — ${p.name} (${p.kind})
- What they say they hire for: ${p.values.join("; ")}.
- Resume framing: ${p.resume}
- Cover letter: ${p.letter}
Use this only to choose emphasis and wording for evidence the candidate already has. Never claim a value; show it through facts.`;
}
