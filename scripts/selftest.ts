import { ghostRisk } from "../src/lib/jobs/ghost";
import { classifyMail, nextStatus } from "../src/lib/mail-classify";
import { extractCode } from "../src/lib/mail-code";
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
import { resumeIssues, tidyResume } from "../src/lib/resume/health";
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
    { id: "i", label: "Passport Country*", type: "text", required: true },
    { id: "j", label: "Have you worked at DoorDash?*", type: "combobox", options: ["I have never worked at DoorDash", "I am a previous employee", "I am a previous DoorDash Dasher"], required: true },
  ], { facts, answers: [], job: { title: "PM", company: "Datadog" }, resume: { name: "x", experience: [{ title: "Analyst", company: "Kaar Tech", start: "2021", end: "2024", bullets: [] }] } as never, coverLetter: null, consent: false });
  const w = Object.fromEntries(p2.fills.map((x) => [x.id, x.value]));
  ok(w.e === "Yes, but I will require sponsorship in the future" && w.f === "No" && w.g === "Yes" && w.h === "No" && w.j === "I have never worked at DoorDash" && p2.missing.some((m) => m.id === "i") && !w.i, "OPT: authorised now with future sponsorship, never 'no restriction'; passport asked, not guessed");
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

// Resume quality gate.
{
  const broken = { name: "Gokul", summary: "gokuldhamodaran.com", skills: [{ group: "Paid Media", items: ["Google Ads", "Budget Management", "ROAS"] }, { group: "Skills", items: ["& CPL Optimization", "Funnel Analysis"] }],
    experience: [{ title: "Senior Analyst", company: "Kaar Tech", start: "2023", end: "2024", bullets: ["Owned paid search and paid social strategy on Google Ads and LinkedIn Ads,", "managed A/B", "testing of ad creatives and landing pages", "Executed ABM campaigns using HubSpot and Demandbase across 100+ accounts."] }] } as never;
  const issues = resumeIssues(broken, "Gokul Dhamodaran");
  const t = tidyResume(broken, "GOKUL DHAMODARAN");
  ok(issues.includes("name incomplete") && issues.includes("summary missing") && issues.includes("broken bullet points"), "quality gate catches broken resumes");
  ok(t.name === "Gokul Dhamodaran" && !t.summary && t.skills!.length === 1 && t.skills![0].items.includes("ROAS & CPL Optimization") && t.experience![0].bullets.length === 2, "tidy repairs name, summary, skills and fragmented bullets");
}

// One-time codes from real emails.
{
  const gh = " Copy and paste this code into the security code field on your application: O2YJR3FJ After you enter the code, resubmit your application. © 2026 Greenhouse 18 West 18th Street, 11th Floor, New York, NY 10011, USA ";
  ok(extractCode(gh) === "O2YJR3FJ", "reads Greenhouse alphanumeric security codes");
  ok(extractCode("Copy and paste this code into the security code field on your application:\n\n\n 4djckW6H \n \n After you enter the code, resubmit your application.") === "4djckW6H", "keeps mixed-case codes exactly as sent");
  ok(extractCode("Copy and paste this code into the field: After that, Resubmit") === null, "never mistakes words for codes");
  ok(extractCode("Your verification code is 482913. It expires in 10 minutes.") === "482913" && extractCode("Use code: 7741 to sign in") === "7741", "reads numeric codes");
  ok(extractCode("2-Step Verification turned on. Your Google Account is now protected") === null, "ignores emails without a code");
}

// Job emails sorted into the right stage.
{
  const k = (subject: string, body: string, from = "no-reply@company.com") => classifyMail(from, subject, body).kind;
  ok(k("Thank you for applying to Robinhood", "Hi Gokul, Thanks for applying to Robinhood! Your application has been received, and our team is in the process of reviewing it. If your profile is a good fit for the role, we'll be in touch shortly with next steps.") === "received", "a 'thanks for applying… next steps' receipt is not an interview");
  ok(k("Thank you for applying to Datadog", "Thank you for your interest in Datadog! We wanted to confirm that we have received your application for the Product Operations Manager job. Our recruiting team manually reviews every single candidate's profile, so it may be a couple of weeks before we can get in touch with you regarding the next steps. We will be in touch soon!") === "received", "Datadog's receipt is a receipt");
  ok(k("Interview invitation – Datadog", "We'd like to schedule a 30-minute call with you. Please pick a time: https://calendly.com/dd/30min") === "interview", "a scheduling invitation is an interview");
  ok(k("Update on your application", "Thank you for your interest in the role and for taking the time to interview with us. Unfortunately, we have decided to move forward with other candidates.") === "rejection", "a rejection that mentions an interview is a rejection");
  ok(k("Next step: HackerRank assessment", "Please complete the coding challenge within 5 days.") === "assessment", "an assessment is its own next round");
  ok(k("Your offer from Stripe", "We are pleased to extend an offer of employment for the role of Product Manager.") === "offer", "offers are recognised");
  ok(k("Security code for your application to Datadog", "Copy and paste this code into the security code field on your application: O2YJR3FJ") === "verification", "security codes are verification mail");
  ok(k("New jobs for you", "10 new product manager jobs near Chicago") === "other", "job alerts are not application mail");
  ok(nextStatus("applied", "received") === "in_review" && nextStatus("interview", "received") === undefined && nextStatus("rejected", "received") === undefined && nextStatus("in_review", "assessment") === "assessment" && nextStatus("interview", "rejection") === "rejected" && nextStatus("offer", "rejection") === undefined, "applications only move forward through the pipeline");
}

// Ghost jobs.
{
  const now = Date.parse("2026-10-26T00:00:00Z");
  const days = (d: number) => new Date(now - d * 864e5).toISOString();
  ok(ghostRisk({ title: "Join our Talent Community", posted_at: days(3) }, { now })?.level === "high", "talent pools are ghost jobs");
  ok(ghostRisk({ title: "Product Manager", posted_at: days(90) }, { now })?.level === "high" && ghostRisk({ title: "Product Manager", posted_at: days(40) }, { now })?.level === "medium", "months-old postings are flagged");
  ok(ghostRisk({ title: "Product Manager", posted_at: days(5) }, { now, replies: { sent: 6, replied: 0, silent: 5 } })?.level === "high", "companies whose applicants never hear back are flagged");
  ok(ghostRisk({ title: "Product Manager", posted_at: days(5) }, { now, replies: { sent: 6, replied: 3, silent: 1 } }) === null, "fresh postings at responsive companies are fine");
}

// Network guard.
ok(isPrivateIp("10.1.2.3") && isPrivateIp("169.254.169.254") && isPrivateIp("::1") && !isPrivateIp("8.8.8.8"), "blocks private and metadata addresses");

// Cover letter quality checks.
ok(lintLetter("I am writing to express my interest. I am passionate!", "Acme").length >= 3, "letter lint catches clichés and length");

plannerChecks().then(() => {
  console.log(fail ? `\n${fail} failed` : "\nAll checks passed");
  process.exit(fail ? 1 : 0);
});
