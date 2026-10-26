// Quick sanity checks for the eligibility engine. Run: npx tsx scripts/selftest.ts
import { matchJob } from "../src/lib/jobs/match";
import { analyzeText } from "../src/lib/jobs/signals";
import { detectCountry } from "../src/lib/jobs/geo";
import { parseResumeText, scoreResume, extractKeywords } from "../src/lib/ats";
import { readFileSync } from "fs";
import { workAuthAnswers } from "../src/lib/answers";
import { roleSimilarity } from "../src/lib/jobs/roles";
import { bestOption, bestName, buildFacts, coreLabel, placeFromResume, planFields } from "../src/lib/agent/fields";
import { isPrivateIp } from "../src/lib/net";
import { parseEventText, parseIcs } from "../src/lib/mail-event";
import { lintLetter } from "../src/lib/tailor";
import type { Job, TargetRole, WorkAuth } from "../src/lib/types";

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fail++; };

const base: Job = { id: "x", source: "greenhouse", country: "GB", title: "Software Engineer", company: "Acme", location: "London, UK", remote: false, description: "We build things with Python and SQL.", url: "https://x", salary_min: null, salary_max: null, currency: null, category: null, contract_time: null, posted_at: new Date().toISOString(), sponsorship: "silent", sponsor_registered: false, restrictions: [] };
const role: TargetRole = { id: "r1", title: "Software Engineer", levels: ["entry", "mid"], keywords: ["python"], priority: 1, active: true };
const intl: WorkAuth = { country: "GB", status: "none", needs_sponsorship_now: true, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent", details: {} };
const citizen: WorkAuth = { ...intl, status: "citizen", needs_sponsorship_now: false, needs_sponsorship_future: false, apply_scope: "any_legal" };
const ctx = (auth: WorkAuth[], loaded = new Set<string>()) => ({ roles: [role], prefs: null, auth, sponsorsLoaded: loaded });

ok(analyzeText("Engineer", "Unfortunately we are unable to offer visa sponsorship for this role.").sponsorship === "no", "detects 'unable to offer visa sponsorship'");
ok(analyzeText("Engineer", "Visa sponsorship is available for the right candidate.").sponsorship === "offers", "detects sponsorship offered");
ok(analyzeText("Engineer", "Candidates must hold an active security clearance.").restrictions.includes("Security clearance"), "detects clearance");
ok(analyzeText("Senior Data Analyst", "").level === "senior", "detects senior level");

ok(matchJob({ ...base, sponsor_registered: true }, ctx([intl], new Set(["GB"]))).eligible, "UK licensed sponsor is eligible for international candidate");
ok(!matchJob(base, ctx([intl], new Set(["GB"]))).eligible, "UK non-sponsor blocked once register is loaded");
ok(matchJob(base, ctx([citizen], new Set(["GB"]))).eligible, "UK citizen not blocked by sponsor register");
ok(!matchJob({ ...base, title: "HGV Class 1 Driver", sponsor_registered: true }, ctx([intl], new Set(["GB"]))).eligible, "UK HGV driver needing sponsorship is blocked");
ok(!matchJob({ ...base, description: "We cannot sponsor visas.", sponsorship: "no" }, ctx([intl])).eligible, "explicit no-sponsorship blocked");
const opt: WorkAuth = { country: "US", status: "post_study_work", needs_sponsorship_now: false, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent", details: {} };
ok(matchJob({ ...base, country: "US", location: "Austin, TX" }, ctx([opt])).eligible, "US OPT: silent posting is eligible");
ok(!matchJob({ ...base, country: "US", location: "Austin, TX", sponsorship: "no" }, ctx([opt])).eligible, "US OPT: won't-sponsor-later blocked under default scope");
ok(!matchJob({ ...base, country: "US", restrictions: ["Citizens only"] }, ctx([opt])).eligible, "Citizens-only blocked for OPT");

ok(detectCountry("Toronto, ON") === "CA" && detectCountry("Remote - US") === "US" && detectCountry("Manchester, England") === "GB", "country detection");

const cv = parseResumeText(`Jane Doe
jane@example.com | +44 7700 900123
SUMMARY
Data analyst with 3 years in fintech.
SKILLS
Languages: SQL, Python
EXPERIENCE
Data Analyst — Monzo  Jan 2022 – Present
• Built SQL dashboards used by 40 people
• Cut reporting time by 30%
EDUCATION
BSc Mathematics — University of Leeds 2021`);
ok(cv.experience?.length === 1 && cv.experience[0].bullets.length === 2, "parses experience bullets");
ok((cv.skills?.[0]?.items || []).includes("SQL"), "parses skills");
const kw = extractKeywords("We need SQL, Python and Tableau. SQL is key.");
ok(kw[0] === "sql" && kw.includes("tableau"), "extracts keywords ranked by frequency");
ok(scoreResume(cv, kw).matched.includes("sql"), "ATS score finds matched keywords");

// Work authorisation: OPT holders are authorised now, need sponsorship later.
const optAns = workAuthAnswers("US", { country: "US", status: "post_study_work", needs_sponsorship_now: true, needs_sponsorship_future: true, apply_scope: "sponsor_only", details: { opt_end: "2099-01-01" } });
ok(optAns.find((a) => a.key === "work_authorized")?.a === "Yes" && optAns.find((a) => a.key === "sponsorship")?.a === "Yes", "OPT: authorised now = Yes, sponsorship later = Yes");

// Resume parser on PDF-style text.
const pdf = parseResumeText(readFileSync(new URL("./fixtures/resume-pdf.txt", import.meta.url), "utf8"));
ok(pdf.phone === "(312) 555-0142" && pdf.experience?.length === 3, "PDF resume: phone and 3 jobs");
ok(pdf.experience?.[1].company === "Brightline Tech" && pdf.experience?.[1].location === "Chennai, India" && pdf.experience?.[1].start === "Oct 2022", "PDF resume: company, location, dates split correctly");
ok((pdf.skills?.[0].items || []).includes("B2B & B2C Campaign Strategy") && (pdf.skills?.[0].items || []).includes("ROAS & CPL Optimization"), "PDF resume: wrapped skill items re-joined");
ok(pdf.education?.length === 2 && (pdf.certifications || []).includes("HubSpot: Digital Advertising Certified"), "PDF resume: education and wrapped certifications");

// Role matching across title families.
ok(roleSimilarity("Marketing Specialist", "Growth Marketing Manager") >= 0.6, "marketing specialist ≈ growth marketing manager");
ok(roleSimilarity("Product Manager", "Product Designer") < 0.45, "product manager ≠ product designer");
ok(analyzeText("Product Manager", "").level === null && analyzeText("Senior Product Manager", "").level === "senior" && analyzeText("Director of Marketing", "").level === "lead", "seniority detection");

// Form answers.
ok(bestOption(["Select...", "Yes", "No"], "Yes") === "Yes" && bestOption(["Male", "Female", "Decline To Self Identify"], "Decline to self-identify") === "Decline To Self Identify", "picks Yes/No and decline options");
ok(bestOption(["Illinois", "Texas"], "IL") === "Illinois", "maps state codes to names");

ok(bestName("Gokul", "GOKUL DHAMODARAN") === "Gokul Dhamodaran" && bestName("Priya Raman", "P. Raman") === "Priya Raman", "uses the fuller name and fixes ALL CAPS");
ok(placeFromResume("Bloomington, IL").country === "United States" && placeFromResume("Toronto, ON").country === "Canada" && placeFromResume("Remote").country === "", "reads city/state/country from the resume line");
ok(coreLabel("Country* Country") === "Country", "removes duplicated labels");
async function plannerChecks() {
  const facts = buildFacts({ email: "a@b.co", name: "Gokul", applicant: null, resume: { name: "GOKUL DHAMODARAN", location: "Bloomington, IL", experience: [], skills: [] } as never, auth: { country: "US", status: "post_study_work", needs_sponsorship_now: true, needs_sponsorship_future: true, apply_scope: "sponsor_or_silent", details: {} } as never, country: "US" });
  const plan = await planFields([
    { id: "a", label: "Are you legally authorised to work full-time in the country where this job is based?* Are you legally authorised to work full-time in the country where this job is based?", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "b", label: "Country* Country", type: "combobox", options: ["Canada", "United States"], required: true },
    { id: "c", label: "How did you hear about this opportunity?*", type: "select", options: ["LinkedIn", "Datadog Careers Page", "Other"], required: true },
    { id: "d", label: "Last Name*", type: "text", required: true },
  ], { facts, answers: [], job: { title: "PM", company: "Datadog" }, resume: null, coverLetter: null, consent: false });
  const v = Object.fromEntries(plan.fills.map((x) => [x.id, x.value]));
  ok(v.a === "Yes" && v.b === "United States" && v.c === "Datadog Careers Page" && v.d === "Dhamodaran" && plan.missing.length === 0, "real Greenhouse questions answered (work auth, country, source, last name)");
  const p2 = await planFields([
    { id: "e", label: "Are you legally authorised to work full-time in the country where this job is based?*", type: "combobox", options: ["Yes, no restriction.", "Yes, but I will require sponsorship in the future", "No"], required: true },
    { id: "f", label: "Will you now require immigration sponsorship (e.g., H-1B, STEM OPT, or any immigration work authorization)?*", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "g", label: "Will you in the future require immigration sponsorship (e.g., H-1B, STEM OPT)?*", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "h", label: "Have you ever been previously employed by Datadog?*", type: "checkboxes", options: ["No", "Yes - Intern", "Yes - Full Time Employment"], required: true },
  ], { facts, answers: [], job: { title: "PM", company: "Datadog" }, resume: { name: "x", experience: [{ title: "Analyst", company: "Kaar Tech", start: "2021", end: "2024", bullets: [] }] } as never, coverLetter: null, consent: false });
  const w = Object.fromEntries(p2.fills.map((x) => [x.id, x.value]));
  ok(w.e === "Yes, but I will require sponsorship in the future" && w.f === "No" && w.g === "Yes" && w.h === "No", "OPT: authorised now with future sponsorship, never 'no restriction'");
}

// Interview times from emails.
{
  const rec = new Date("2026-10-26T15:00:00Z");
  const a = parseEventText("Hi Gokul, can you do a 30-minute call on Tuesday, October 28 at 2:00 PM CT? Join: https://zoom.us/j/123456", rec);
  ok(a?.start === "2026-10-28T19:00:00.000Z" && a.minutes === 30 && a.link === "https://zoom.us/j/123456", "reads '2:00 PM CT' (daylight time) and the Zoom link");
  const b = parseEventText("We'd like to meet 11/4 10am-10:45am ET", rec);
  ok(b?.start === "2026-11-04T15:00:00.000Z" && b.minutes === 45, "reads numeric date, a time range, and standard time after the switch");
  const c = parseEventText("Please pick a time that works: https://calendly.com/acme-recruiting/30min", rec);
  ok(c?.needsScheduling === true && c.start === null, "scheduling links become 'pick a time'");
  const d = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261029T170000Z\nDTEND:20261029T174500Z\nSUMMARY:Interview with Acme\nLOCATION:https://meet.google.com/abc-defg-hij\nEND:VEVENT\nEND:VCALENDAR");
  ok(d?.start === "2026-10-29T17:00:00.000Z" && d.minutes === 45 && d.link === "https://meet.google.com/abc-defg-hij" && d.title === "Interview with Acme", "reads calendar invites");
  ok(parseEventText("Thanks for applying on 10/26. We will be in touch.", rec) === null, "ignores dates without a time");
}

// Network guard.
ok(isPrivateIp("10.1.2.3") && isPrivateIp("169.254.169.254") && isPrivateIp("::1") && !isPrivateIp("8.8.8.8"), "blocks private and metadata addresses");

// Cover letter quality checks.
ok(lintLetter("I am writing to express my interest. I am passionate!", "Acme").length >= 3, "letter lint catches clichés and length");

plannerChecks().then(() => {
  console.log(fail ? `\n${fail} failed` : "\nAll checks passed");
  process.exit(fail ? 1 : 0);
});
