// Country rules shown to users and used by the eligibility engine.
// Facts reviewed October 2026. Immigration rules change often: every country
// lists official sources and the app tells users to confirm before acting.

export type Route = { name: string; summary: string };
export type Country = {
  code: string;
  name: string;
  currency: string;
  tier: "full" | "standard";
  liveSearch: boolean; // Adzuna coverage
  routes: Route[];
  studentPath: string;
  facts: string[];
  sponsorData: string | null;
  sources: { label: string; url: string }[];
  defaultCities: string[];
};

export const COUNTRIES: Country[] = [
  {
    code: "US",
    name: "United States",
    currency: "USD",
    tier: "full",
    liveSearch: true,
    routes: [
      { name: "OPT and STEM OPT", summary: "12 months after your degree, plus 24 more for STEM degrees with an E-Verify employer (Form I-983)." },
      { name: "H-1B", summary: "Degree-level “specialty occupation” jobs; employer files the petition, selected by lottery." },
      { name: "O-1 / L-1", summary: "Extraordinary ability, or a transfer within the same company." },
    ],
    studentPath: "F-1 students usually work on OPT (and STEM OPT) first, then need an employer willing to sponsor H-1B.",
    facts: [
      "STEM OPT only allows E-Verify employers; total unemployment is limited to 150 days across OPT and STEM OPT.",
      "A $100,000 fee on new H-1B petitions for people outside the US was blocked by a federal court in 2026; an appeal is pending. Changes of status inside the US (for example F-1 to H-1B) were exempt.",
      "Truck driving is not an H-1B occupation, and worker visas for commercial truck drivers were paused in August 2025.",
    ],
    sponsorData: "Employer H-1B history from Department of Labor LCA disclosure data",
    sources: [
      { label: "USCIS: STEM OPT extension", url: "https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt" },
      { label: "USCIS: H-1B specialty occupations", url: "https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations" },
      { label: "DOL: LCA disclosure data", url: "https://www.dol.gov/agencies/eta/foreign-labor/performance" },
    ],
    defaultCities: ["New York", "San Francisco", "Seattle", "Austin", "Chicago", "Boston"],
  },
  {
    code: "GB",
    name: "United Kingdom",
    currency: "GBP",
    tier: "full",
    liveSearch: true,
    routes: [
      { name: "Skilled Worker visa", summary: "Job offer from a Home Office licensed sponsor, usually degree-level (RQF 6) and at least £41,700 or the job's going rate." },
      { name: "Graduate visa", summary: "Work for any employer after a UK degree: 2 years (3 for PhD) if you apply by 31 Dec 2026, 18 months from 1 Jan 2027." },
      { name: "Global Talent / Scale-up", summary: "For endorsed leaders in their field, or fast-growing companies." },
    ],
    studentPath: "Graduates usually start on the Graduate visa, then move to a Skilled Worker visa with a licensed sponsor.",
    facts: [
      "Only employers on the Register of Licensed Sponsors can sponsor. Vantage checks every UK job against it.",
      "Below-degree jobs (RQF 3–5) only qualify if they're on the Immigration Salary List or Temporary Shortage List (in force until 31 Dec 2026).",
      "HGV and lorry drivers (SOC 8211) are not eligible for Skilled Worker sponsorship.",
      "Recruiting care workers from overseas closed on 22 July 2025.",
    ],
    sponsorData: "Home Office Register of Licensed Sponsors (updated almost daily)",
    sources: [
      { label: "GOV.UK: Skilled Worker visa", url: "https://www.gov.uk/skilled-worker-visa" },
      { label: "GOV.UK: Register of licensed sponsors", url: "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" },
      { label: "GOV.UK: Graduate visa", url: "https://www.gov.uk/graduate-visa" },
    ],
    defaultCities: ["London", "Manchester", "Birmingham", "Edinburgh", "Leeds", "Bristol"],
  },
  {
    code: "CA",
    name: "Canada",
    currency: "CAD",
    tier: "full",
    liveSearch: true,
    routes: [
      { name: "Post-graduation work permit", summary: "Open work permit after an eligible Canadian program — up to 3 years for 2+ year programs and qualifying master's." },
      { name: "LMIA work permit", summary: "Employer proves no Canadian is available (Labour Market Impact Assessment)." },
      { name: "Express Entry", summary: "Points-based permanent residence; 2026 category draws include healthcare, STEM, trades and transport." },
    ],
    studentPath: "Graduates usually work on a PGWP, gain Canadian experience, then apply for permanent residence through Express Entry.",
    facts: [
      "Job-offer points were removed from Express Entry on 25 March 2025.",
      "Low-wage LMIAs are refused in metro areas with 6% or higher unemployment, and from 1 April 2026 are capped at 10% of a worksite.",
      "Vantage flags employers with a recent positive LMIA.",
    ],
    sponsorData: "ESDC positive LMIA employer list (quarterly)",
    sources: [
      { label: "IRCC: Post-graduation work permit", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/work/after-graduation.html" },
      { label: "Positive LMIA employers (open data)", url: "https://open.canada.ca/data/en/dataset/90fed587-1364-4f33-a9ee-208181dc0b97" },
      { label: "IRCC: Express Entry", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html" },
    ],
    defaultCities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
  },
  {
    code: "AU",
    name: "Australia",
    currency: "AUD",
    tier: "full",
    liveSearch: true,
    routes: [
      { name: "Skills in Demand visa (482)", summary: "Core Skills stream: occupation on the Core Skills Occupation List and pay of at least A$79,499. Specialist stream: A$146,717+." },
      { name: "Temporary Graduate visa (485)", summary: "2 years after a bachelor's or coursework master's, 3 after research degrees." },
      { name: "Skilled independent / nominated", summary: "Points-tested permanent visas (189, 190, 491)." },
    ],
    studentPath: "Graduates usually work on a 485 visa, then move to a Skills in Demand visa with an approved sponsor or a points-tested visa.",
    facts: [
      "Income thresholds are indexed every 1 July; the higher of the threshold or the market rate applies.",
      "There is no public list of approved sponsors yet, so Vantage relies on what each posting says.",
    ],
    sponsorData: null,
    sources: [
      { label: "Home Affairs: Skills in Demand visa", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-482" },
      { label: "Home Affairs: Temporary Graduate visa", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-graduate-485" },
    ],
    defaultCities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
  },
  {
    code: "DE",
    name: "Germany",
    currency: "EUR",
    tier: "standard",
    liveSearch: true,
    routes: [
      { name: "EU Blue Card", summary: "Degree-level job paying at least €50,700 (€45,934 for shortage jobs, recent graduates and IT specialists)." },
      { name: "Opportunity Card", summary: "12-month job-search permit based on points; part-time work allowed while searching." },
    ],
    studentPath: "Graduates of German universities get 18 months to find work, then move to a Blue Card or skilled-worker permit.",
    facts: ["Many tech employers hire in English, but German skills widen your options a lot."],
    sponsorData: null,
    sources: [{ label: "Make it in Germany", url: "https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card" }],
    defaultCities: ["Berlin", "Munich", "Hamburg", "Frankfurt"],
  },
  {
    code: "IE",
    name: "Ireland",
    currency: "EUR",
    tier: "standard",
    liveSearch: false,
    routes: [
      { name: "Critical Skills Employment Permit", summary: "€40,904+ with a relevant degree for listed shortage roles." },
      { name: "General Employment Permit", summary: "€36,605+ for most other eligible jobs." },
    ],
    studentPath: "Stamp 1G lets graduates stay 12 months (Level 8) or 24 months (Level 9) to work and find a permit-sponsoring employer.",
    facts: ["Thresholds above took effect 1 March 2026."],
    sponsorData: null,
    sources: [{ label: "DETE: Employment permits", url: "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/" }],
    defaultCities: ["Dublin", "Cork", "Galway"],
  },
  {
    code: "NZ",
    name: "New Zealand",
    currency: "NZD",
    tier: "standard",
    liveSearch: true,
    routes: [{ name: "Accredited Employer Work Visa", summary: "Job offer from an accredited employer at or above the required pay." }],
    studentPath: "Post-study work visas let graduates work for any employer, then move to an AEWV.",
    facts: ["Immigration NZ offers an employer accreditation lookup; there's no public bulk list."],
    sponsorData: null,
    sources: [{ label: "Immigration NZ: AEWV", url: "https://www.immigration.govt.nz/new-zealand-visas/visas/visa/accredited-employer-work-visa" }],
    defaultCities: ["Auckland", "Wellington", "Christchurch"],
  },
  {
    code: "SG",
    name: "Singapore",
    currency: "SGD",
    tier: "standard",
    liveSearch: true,
    routes: [{ name: "Employment Pass", summary: "From S$5,600/month (S$6,200 in financial services), higher with age; must pass the COMPASS points test." }],
    studentPath: "Graduates apply for an Employment Pass once they have an offer.",
    facts: ["Minimum EP salaries rise to S$6,000 (S$6,600 financial services) from January 2027."],
    sponsorData: null,
    sources: [{ label: "MOM: Employment Pass", url: "https://www.mom.gov.sg/passes-and-permits/employment-pass" }],
    defaultCities: ["Singapore"],
  },
  {
    code: "IN",
    name: "India",
    currency: "INR",
    tier: "standard",
    liveSearch: true,
    routes: [],
    studentPath: "No visa needed for Indian citizens.",
    facts: [],
    sponsorData: null,
    sources: [],
    defaultCities: ["Bengaluru", "Hyderabad", "Pune", "Mumbai", "Chennai", "Delhi NCR"],
  },
  {
    code: "NL",
    name: "Netherlands",
    currency: "EUR",
    tier: "standard",
    liveSearch: true,
    routes: [{ name: "Highly Skilled Migrant", summary: "Job with an IND-recognised sponsor at the required salary." }],
    studentPath: "Graduates can use the one-year orientation year (zoekjaar) to find work.",
    facts: [],
    sponsorData: null,
    sources: [{ label: "IND: Highly skilled migrant", url: "https://ind.nl/en/residence-permits/work/highly-skilled-migrant" }],
    defaultCities: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
  },
];

export const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
export const FOCUS_COUNTRIES = COUNTRIES.filter((c) => c.tier === "full");

export const ALL_NATIONALITIES = [
  "India", "United States", "United Kingdom", "Canada", "Australia", "China", "Nigeria", "Pakistan", "Bangladesh", "Philippines",
  "Nepal", "Sri Lanka", "Vietnam", "Ghana", "Kenya", "Brazil", "Mexico", "Germany", "France", "Ireland", "New Zealand",
  "Singapore", "South Africa", "Egypt", "Indonesia", "Malaysia", "Turkey", "Iran", "Saudi Arabia", "United Arab Emirates",
  "South Korea", "Japan", "Italy", "Spain", "Poland", "Ukraine", "Colombia", "Other",
];

export const INDUSTRIES = [
  "Technology & software", "Fintech & banking", "Healthcare", "Logistics & transport", "Retail & e-commerce", "Consulting",
  "Insurance", "Energy & utilities", "Government", "Education", "Media & entertainment", "Manufacturing", "Telecom",
  "Travel & hospitality", "Construction & trades", "Real estate", "Nonprofit", "Legal", "Pharma & biotech", "Automotive",
];

type OccRule = { re: RegExp; countries: string[]; text: string; severity: "blocked" | "warn" };

// Occupation-level rules for people who need sponsorship.
export const OCCUPATION_RULES: OccRule[] = [
  { re: /\b(hgv|lgv|lorry|class ?[12] driver|c\+?e driver|truck driver|haulage driver)\b/i, countries: ["GB"], severity: "blocked",
    text: "HGV/lorry drivers aren't eligible for UK Skilled Worker sponsorship" },
  { re: /\b(care (worker|assistant)|senior carer|support worker|home carer|healthcare assistant)\b/i, countries: ["GB"], severity: "blocked",
    text: "UK closed overseas recruitment for care workers in July 2025" },
  { re: /\b(truck driver|cdl|tractor[- ]trailer|otr driver|long[- ]haul)\b/i, countries: ["US"], severity: "warn",
    text: "Truck driving isn't an H-1B occupation, and truck-driver worker visas were paused in 2025" },
];

export function occupationCheck(country: string, title: string) {
  return OCCUPATION_RULES.find((r) => r.countries.includes(country) && r.re.test(title)) || null;
}
