import { ghostRisk } from "../src/lib/jobs/ghost";
import { runNow, todaysRuns, cleanSchedule } from "../src/lib/agent/schedule";
import { classifyMail, nextStatus } from "../src/lib/mail-classify";
import { extractCode } from "../src/lib/mail-code";
// Quick sanity checks for the eligibility engine. Run: npx tsx scripts/selftest.ts
import { jobTypeOf, matchJob, workModeOf, workModeOk } from "../src/lib/jobs/match";
import { autoSkipReason, interleaveByPriority, shareOfLimit, taskPriority } from "../src/lib/agent/plan";
import { analyzeText } from "../src/lib/jobs/signals";
import { detectCountry } from "../src/lib/jobs/geo";
import { parseResumeText, scoreResume, extractKeywords } from "../src/lib/ats";
import { readFileSync } from "fs";
import { workAuthAnswers } from "../src/lib/answers";
import { roleSimilarity } from "../src/lib/jobs/roles";
import { ruleIntent } from "../src/lib/assistant";
import { bestOption, bestName, qkeyOf, buildFacts, coreLabel, placeFromResume, planFields, lockedKind } from "../src/lib/agent/fields";
import { siteKey } from "../src/lib/agent/sites";
import { isJobMail } from "../src/lib/agent/mailsync";
import { __validate } from "../src/lib/agent/pilot";
import { testCtx } from "../src/lib/agent/pilot-test";
import { isPrivateIp } from "../src/lib/net";
import { parseEventText, parseIcs } from "../src/lib/mail-event";
import { resumeIssues, tidyResume } from "../src/lib/resume/health";
import { lintLetter } from "../src/lib/tailor";
import type { Job, TargetPrefs, TargetRole, WorkAuth } from "../src/lib/types";
import { AI_PRICES, FALLBACK_PRICE, anthropicUsage, costUsd, geminiUsage, priceFor } from "../src/lib/ai-pricing";
import { runWithAi, tagAi } from "../src/lib/ai-context";
import { claude, __usageQueue } from "../src/lib/ai";

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
ok(roleSimilarity("Product Manager", "Senior Product Marketing Manager") < 0.45, "product manager ≠ product marketing manager");
ok(roleSimilarity("Product Manager", "Senior Product Manager, Marketplace") >= 0.6, "product manager ≈ senior product manager");

// A "Business Analyst" filter shows business analyst titles and real synonyms — never marketing or sales roles.
for (const t of ["Business Analyst", "Senior Business Analyst", "IT Business Analyst", "Business Systems Analyst", "Business Analyst – Marketing Technology", "Operations Analyst", "Strategy & Operations Manager"]) {
  ok(roleSimilarity("business analyst", t) >= 0.55, `business analyst ≈ ${t}`);
}
for (const t of ["Senior Marketing Operations Analyst", "Marketing Analyst", "Marketing Specialist", "Business Development Manager", "Sales Operations Analyst", "Brand Strategy Manager", "Director, Global Integrated Campaign Strategy & Operations", "Security Operations Analyst", "Financial Operations Analyst"]) {
  ok(roleSimilarity("business analyst", t) < 0.45, `business analyst ≠ ${t}`);
}
ok(roleSimilarity("Marketing Specialist", "Demand Generation Specialist") >= 0.6 && roleSimilarity("Marketing Specialist", "Marketing Operations Analyst") >= 0.6, "marketing targets keep their own family");
ok(roleSimilarity("Product Specialist", "Product Marketing Specialist") < 0.45 && roleSimilarity("Product Manager", "Product Marketing Manager") < 0.45, "product targets don't pull in product marketing");
{
  // Filtering Live jobs by one target scores against that target only (the role filter bug).
  const ba: TargetRole = { id: "ba", title: "business analyst", levels: ["entry", "mid"], keywords: [], priority: 2, active: true };
  const mkt: TargetRole = { id: "mkt", title: "marketing specialist", levels: ["mid", "senior"], keywords: [], priority: 1, active: true };
  const mops = { ...base, country: "US", title: "Senior Marketing Operations Analyst" };
  ok((matchJob(mops, { roles: [ba, mkt], prefs: null, auth: [] }).roleFit ?? 0) >= 0.6, "all targets: marketing ops analyst fits the marketing target");
  ok((matchJob(mops, { roles: [ba], prefs: null, auth: [] }).roleFit ?? 1) < 0.45, "business analyst filter: marketing ops analyst is filtered out");
  ok(matchJob({ ...base, country: "US", title: "Business Analyst II" }, { roles: [ba], prefs: null, auth: [] }).role?.id === "ba", "business analyst filter: Business Analyst II stays");
}

// Auto-apply ordering: every target gets a turn, weighted by priority (Top 3 : High 2 : Normal 1).
{
  const rs = [{ id: "a", priority: 1 }, { id: "b", priority: 2 }, { id: "c", priority: 3 }];
  const cands = [...Array.from({ length: 5 }, (_, i) => ({ roleId: "a", score: 60 + i })), ...Array.from({ length: 5 }, (_, i) => ({ roleId: "b", score: 90 + i })), { roleId: "c", score: 99 }];
  const first6 = interleaveByPriority(cands, rs).slice(0, 6).map((c) => c.roleId).join("");
  ok(first6 === "aaabbc", `priority interleave: top target goes first, lower ones still get turns (${first6})`);
  ok(interleaveByPriority(cands, rs)[0].score === 64, "priority interleave: best match first within a target");
  const share = shareOfLimit([{ id: "a", priority: 1, active: true }, { id: "b", priority: 2, active: true }, { id: "c", priority: 3, active: true }, { id: "d", priority: 1, active: false }], 10);
  ok(share.a + share.b + share.c === 10 && share.a > share.b && share.b > share.c && !share.d, `daily share follows priority (${JSON.stringify(share)})`);
  ok(taskPriority(false, 1) < taskPriority(false, 3) && taskPriority(true, 3) < taskPriority(false, 1), "queue order: important first, then by target priority");
}

// Work arrangements and freshness.
{
  const remoteOnly = { remote_ok: true, work_modes: ["remote"] };
  ok(!workModeOk({ ...base, remote: false }, remoteOnly) && workModeOk({ ...base, remote: true }, remoteOnly), "remote-only preference skips on-site jobs");
  ok(workModeOf({ ...base, location: "Chicago, IL (Hybrid)" }) === "hybrid" && workModeOk({ ...base, location: "Chicago (Hybrid)" }, { remote_ok: false, work_modes: ["onsite"] }), "hybrid detected; fine for an on-site person");
  ok(["Full-Time", "FullTime", "full_time", "permanent_full_time", null].every((c) => jobTypeOf({ title: "Analyst", contract_time: c }) === "full_time")
    && ["Part-Time", "PartTime", "part_time"].every((c) => jobTypeOf({ title: "Analyst", contract_time: c }) === "part_time")
    && jobTypeOf({ title: "Business Analyst Intern", contract_time: null }) === "internship" && jobTypeOf({ title: "Internal Audit Analyst", contract_time: null }) === "full_time"
    && jobTypeOf({ title: "Analyst", contract_time: "Contractor" }) === "contract", "job type read from feed field or title");
  ok(workModeOk({ ...base, remote: true }, { remote_ok: true, work_modes: null }) && !workModeOk({ ...base, remote: true }, { remote_ok: false, work_modes: null }), "older prefs fall back to remote_ok");
  const usJob = { ...base, country: "US", location: "Austin, TX", title: "Software Engineer" };
  const m = matchJob(usJob, { roles: [role], prefs: null, auth: [] });
  const fresh: TargetPrefs = { countries: [], locations: [], remote_ok: true, industries: [], industry_mode: "all", salary_min: null, currency: null, job_types: [], companies: [], blocked_companies: [], max_days_old: 14 };
  ok(autoSkipReason({ ...usJob, posted_at: new Date(Date.now() - 20 * 864e5).toISOString() }, m, fresh, { vetted: true }) === "Older than your freshness setting", "agent skips posts older than the freshness setting");
  ok(autoSkipReason(usJob, m, fresh, { vetted: true }) === null, "agent applies to a fresh, close, verified match");
  ok(autoSkipReason(usJob, m, null, { vetted: false }) === "Careers site not verified yet", "agent only uses verified careers sites");
}
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
  const ma = plan.missing.find((m) => m.id === "a");
  ok(!v.a && ma?.locked === "work_auth" && ma.suggest === "Yes" && v.b === "United States" && v.c === "Datadog Careers Page" && v.d === "Dhamodaran" && plan.missing.length === 1, "work-authorisation question asked (suggested Yes), other Greenhouse questions answered");
  const authQ = "Are you legally authorised to work full-time in the country where this job is based?";
  const confirmed = await planFields([
    { id: "a", label: `${authQ}* ${authQ}`, type: "combobox", options: ["Yes", "No"], required: true },
    { id: "a2", label: "Are you authorized to work in the US without restriction?*", type: "combobox", options: ["Yes", "No"], required: true },
  ], { facts, answers: [{ qkey: qkeyOf(authQ), question: authQ, answer: "Yes" }], job: { title: "PM", company: "Datadog" }, resume: null, coverLetter: null, consent: false });
  ok(confirmed.fills.some((x) => x.id === "a" && x.value === "Yes") && confirmed.missing.some((m) => m.id === "a2") && !confirmed.fills.some((x) => x.id === "a2"), "confirmed answer reused only for the exact same wording");
  const p2 = await planFields([
    { id: "e", label: "Are you legally authorised to work full-time in the country where this job is based?*", type: "combobox", options: ["Yes, no restriction.", "Yes, but I will require sponsorship in the future", "No"], required: true },
    { id: "f", label: "Will you now require immigration sponsorship (e.g., H-1B, STEM OPT, or any immigration work authorization)?*", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "g", label: "Will you in the future require immigration sponsorship (e.g., H-1B, STEM OPT)?*", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "h", label: "Have you ever been previously employed by Datadog?*", type: "checkboxes", options: ["No", "Yes - Intern", "Yes - Full Time Employment"], required: true },
    { id: "i", label: "Passport Country*", type: "text", required: true },
    { id: "j", label: "Have you worked at DoorDash?*", type: "combobox", options: ["I have never worked at DoorDash", "I am a previous employee", "I am a previous DoorDash Dasher"], required: true },
  ], { facts, answers: [], job: { title: "PM", company: "Datadog" }, resume: { name: "x", experience: [{ title: "Analyst", company: "Kaar Tech", start: "2021", end: "2024", bullets: [] }] } as never, coverLetter: null, consent: false });
  const w = Object.fromEntries(p2.fills.map((x) => [x.id, x.value]));
  const sug = Object.fromEntries(p2.missing.map((m) => [m.id, m.suggest]));
  ok(!w.e && !w.f && !w.g && sug.e === "Yes, but I will require sponsorship in the future" && sug.f === "No" && sug.g === "Yes" && w.h === "No" && w.j === "I have never worked at DoorDash" && p2.missing.some((m) => m.id === "i") && !w.i, "OPT: eligibility asked with correct suggestions (never 'no restriction'); passport asked, not guessed");
  const p3 = await planFields([
    { id: "k", label: "Have you ever been convicted of a felony?*", type: "combobox", options: ["Yes", "No"], required: true },
    { id: "l", label: "What is your current salary?", type: "text", required: false },
    { id: "m", label: "Are you at least 18 years of age?*", type: "combobox", options: ["Yes", "No"], required: true },
  ], { facts: { ...facts, adult: "Yes" }, answers: [{ qkey: qkeyOf("Have you ever been convicted of a crime?"), question: "Have you ever been convicted of a crime?", answer: "No" }], job: { title: "PM", company: "Datadog" }, resume: null, coverLetter: null, consent: false });
  const z = Object.fromEntries(p3.fills.map((x) => [x.id, x.value]));
  ok(!z.k && p3.missing.some((m) => m.id === "k" && m.locked === "conviction") && !z.l && !p3.missing.some((m) => m.id === "l") && z.m === "Yes", "conviction never taken from a similar answer; optional salary history left blank; 18+ from confirmation");
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
  ok(k("Thank you for your application to Loadsmart", "Hi Gokul, Thank you for your interest in Loadsmart! We wanted to let you know we received your application for Product Marketing Specialist. Our team will review your application and will be in touch if your qualifications match our needs for the role. If you are not selected for this position, keep an eye on our jobs page as we're growing.") === "received", "a receipt that says what happens if you're not selected is not a rejection");
  ok(k("Further Action May Be Required For Your Job Application", "Your application has been received. THANK YOU FOR SUBMITTING YOUR RESUME/CV. IMPORTANT: If you did not proceed to the final step of the application process earlier, please complete this form now to be considered for employment.") === "action", "an 'application not finished' email asks for action");
  ok(k("Your application", "Unfortunately, we will not be moving forward with your application at this time.") === "rejection", "a real rejection is still a rejection");
  ok(nextStatus("applied", "received") === undefined && nextStatus("applied", "in_review") === "in_review" && nextStatus("interview", "received") === undefined && nextStatus("rejected", "received") === undefined && nextStatus("in_review", "assessment") === "assessment" && nextStatus("interview", "rejection") === "rejected" && nextStatus("offer", "rejection") === undefined, "applications only move forward through the pipeline");
}

// Ask your agent: plain requests become the right change.
{
  const roles = [{ id: "1", title: "business analyst" }] as unknown as TargetRole[];
  ok(ruleIntent("apply for jobs for business analyst role", roles).changes.length === 0, "an existing target isn't added again as 'Jobs For Business Analyst'");
  const c = ruleIntent("Also target Product Analyst roles in London", roles).changes;
  ok(c.length >= 1 && c[0].type === "add_role" && (c[0] as { title: string }).title === "Product Analyst", "'also target X roles' adds X (not a job search)");
  ok(ruleIntent("apply now", roles).asksAgent, "'apply now' explains what the agent is doing");
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

// Labels with site validation text and hints still map to the right fact.
{
  const lab = "Address line 1 (Street address, P.O. Box, etc...) This field is required";
  ok(coreLabel(lab) === "Address line 1", "strips validation text and hints from labels");
}

// Network guard.
ok(isPrivateIp("10.1.2.3") && isPrivateIp("169.254.169.254") && isPrivateIp("::1") && !isPrivateIp("8.8.8.8"), "blocks private and metadata addresses");

// Cover letter quality checks.
ok(lintLetter("I am writing to express my interest. I am passionate!", "Acme").length >= 3, "letter lint catches clichés and length");

// Safety: kill-switch keys never cover a whole careers platform.
ok(siteKey("https://boards.greenhouse.io/embed/job_app?for=acme") === "greenhouse.io/acme" && siteKey("https://job-boards.greenhouse.io/acme/jobs/1") === "greenhouse.io/acme", "greenhouse block key is per employer, embed or not");
ok(siteKey("https://apply.workable.com/j/ABC") === "" && siteKey("https://recruiting.paylocity.com/Recruiting/Jobs/Details/1") === "", "unknown employer on a shared host records no block");
ok(siteKey("https://career2.successfactors.com/career?company=Acme") === "successfactors/acme" && siteKey("https://workforcenow.adp.com/x.html?cid=abc") === "adp.com/abc", "query-string tenants");

// Safety: experience questions are not age questions.
ok(lockedKind("Are you at least 18 years of age?") === "age" && lockedKind("Are you 18 or older?") === "age", "age questions are locked");
ok(!lockedKind("Have you worked over 18 months in a startup?") && !lockedKind("Can you work at least 16 hours a week?"), "durations aren't age questions");

// Safety: only job mail is kept.
ok(!isJobMail({ kind: "verification", from_addr: "alerts@chase.com", subject: "Your verification code" }, [], ["amazon"]), "bank codes are not kept");
ok(isJobMail({ kind: "verification", from_addr: "no-reply@portal-na.idprism-auth.amazon.dev", subject: "Your verification code" }, [], ["amazon"]), "codes from a site the agent is applying on are kept");
ok(isJobMail({ kind: "other", from_addr: "no-reply@us.greenhouse-mail.io", subject: "Thanks" }, []) && !isJobMail({ kind: "other", from_addr: "news@cleverbridge.com", subject: "Sale" }, []), "careers senders match as whole names");

// Pilot safety: whatever the AI proposes, the rules hold.
{
  const snap = { url: "x", items: [
    { i: 0, kind: "text", label: "Address Line 1*", value: "" }, { i: 1, kind: "text", label: "Phone Extension", value: "" },
    { i: 2, kind: "combobox", label: "Are you legally authorized to work in the country in which you are applying?*", value: "", required: true },
    { i: 3, kind: "combobox", label: "Do you have a criminal conviction?*", value: "", required: true },
    { i: 4, kind: "button", label: "Submit", final: true }, { i: 5, kind: "password", label: "Password" },
  ] };
  const v = __validate({ say: "x", status: "ready", submit: 4, actions: [
    { do: "fill", i: 0, value: "{{address_line_1}}" }, { do: "fill", i: 1, value: "{{phone}}" }, { do: "choose", i: 2, value: "No" },
    { do: "choose", i: 3, value: "No" }, { do: "click", i: 4 }, { do: "fill", i: 5, value: "hunter2" }, { do: "fill", i: 0, value: "{{nope}}" },
  ] }, snap, new Map([[2, { value: "Yes" }]]), testCtx());
  ok(v.actions.some((a) => a.i === 0 && a.value === "1 Main St") && !v.actions.some((a) => a.value === "{{nope}}"), "placeholders filled in (variants too); unknown ones never typed");
  ok(!v.actions.some((a) => a.i === 1) && !v.actions.some((a) => a.i === 5) && !v.actions.some((a) => a.i === 4), "no phone in extension box, no password typing, no final submit click");
  ok(v.actions.find((a) => a.i === 2)?.value === "Yes" && !v.actions.some((a) => a.i === 3), "eligibility answers only from the applicant; unknown locked questions withheld");
  ok(v.status === "ask" && v.ask.some((q) => q.locked === "conviction"), "missing locked answers are asked before anything is ready to submit");
}

// AI usage meter: price table, token mapping, and that a call is recorded with its user and feature.
ok(costUsd("claude-sonnet-5-5", { input: 1_000_000, output: 1_000_000 }) === 18, "cost: Sonnet 1M in + 1M out = $3 + $15");
ok(costUsd("claude-haiku-5-5", { input: 2000, output: 500 }) === 0.0045, "cost: Haiku 2k in + 500 out = $0.0045");
ok(costUsd("claude-sonnet-5-5", { cacheRead: 1_000_000, cacheWrite: 1_000_000 }) === 4.05, "cost: Sonnet cache read $0.30 + cache write $3.75 per 1M");
ok(costUsd("gemini-3.8-flash", { input: 1_000_000, output: 100_000, thinking: 900_000 }) === 3.5, "cost: Gemini thinking tokens are billed as output");
ok(costUsd("gemini-3.5-flash-lite", { input: 1_000_000, output: 1_000_000 }) === 0.5, "cost: Flash-Lite $0.10 + $0.40");
ok(priceFor("claude-haiku-5-5-20261001").price === AI_PRICES["claude-haiku-5-5"], "price: dated snapshot uses its base model's price");
ok(priceFor("claude-sonnet-9").source === "family" && priceFor("some-new-model").price === FALLBACK_PRICE, "price: unknown Sonnet → family price; unknown model → fallback");
ok(costUsd("claude-haiku-5-5", { input: -5, output: Number.NaN }) === 0, "cost: bad token counts never produce a negative or NaN cost");
{
  const a = anthropicUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 });
  ok(a.input === 100 && a.cacheRead === 900 && a.cacheWrite === 50 && a.output === 20, "usage: Anthropic usage incl. cache tokens");
  const g = geminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 30, thoughtsTokenCount: 200 });
  ok(g.input === 600 && g.cacheRead === 400 && g.output === 30 && g.thinking === 200, "usage: Gemini prompt minus cached, thinking separate");
}

async function aiMeterChecks() {
  const env = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GEMINI_API_KEY, gg: process.env.GOOGLE_API_KEY, s: process.env.INGEST_SECRET };
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.INGEST_SECRET = "test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ model: "claude-haiku-5-5", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 2000, output_tokens: 500 } }), { status: 200 })) as typeof fetch;
  try {
    __usageQueue.length = 0;
    const uid = "11111111-2222-4333-8444-555555555555";
    const out = await runWithAi({ userId: uid, feature: "route" }, async () => {
      tagAi({ taskId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
      return claude("sys", [{ role: "user", content: "x" }], 50, { feature: "selftest" });
    });
    const row = __usageQueue[0];
    ok(out === "hi" && __usageQueue.length === 1, "meter: one row queued per AI request, reply unchanged");
    ok(row?.user_id === uid && row?.task_id === "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" && row?.feature === "selftest" && row?.provider === "anthropic", "meter: user + task from runWithAi, explicit feature wins");
    ok(row?.cost === 0.0045 && row?.input === 2000 && row?.output === 500 && row?.ok === true, "meter: tokens and cost recorded");
    __usageQueue.length = 0;
    await runWithAi({ feature: "pilot" }, () => claude("sys", [{ role: "user", content: "x" }], 50));
    ok(__usageQueue[0]?.feature === "pilot" && __usageQueue[0]?.user_id === null, "meter: route feature used when the caller names none");
    __usageQueue.length = 0;
    globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as typeof fetch;
    await claude("sys", [{ role: "user", content: "x" }], 50, { model: "tailor" });
    ok(__usageQueue[0]?.ok === false && __usageQueue[0]?.status === 400 && __usageQueue[0]?.feature === "tailor", "meter: failures recorded (feature from model kind outside any run)");
  } finally {
    __usageQueue.length = 0;
    globalThis.fetch = realFetch;
    for (const [k, v] of [["ANTHROPIC_API_KEY", env.a], ["GEMINI_API_KEY", env.g], ["GOOGLE_API_KEY", env.gg], ["INGEST_SECRET", env.s]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Auto-apply schedule: set times in the person's own time zone, quiet hours, spreading the daily limit.
{
  const at = (iso: string) => Date.parse(iso);
  const sc = { tz: "America/Chicago", times: ["08:30", "12:30", "18:30"], quiet: { from: 22, to: 7 } };
  ok(runNow(null, at("2026-10-27T03:00:00Z")).run, "schedule: none = runs every time");
  ok(runNow(sc, at("2026-10-27T13:33:00Z")).run && runNow(sc, at("2026-10-27T13:33:00Z")).runsLeft === 3, "schedule: 8:33 AM Chicago is the 8:30 run, 3 runs left");
  ok(!runNow(sc, at("2026-10-27T13:45:00Z")).run, "schedule: 8:45 AM is not a run time");
  ok(runNow(sc, at("2026-10-27T17:31:00Z")).runsLeft === 2, "schedule: at 12:31 PM two runs are left");
  ok(!runNow({ tz: "America/Chicago", quiet: { from: 22, to: 7 } }, at("2026-10-28T04:00:00Z")).run, "schedule: 11 PM is quiet hours");
  ok(runNow({ tz: "America/Chicago", quiet: { from: 22, to: 7 } }, at("2026-10-27T15:00:00Z")).run, "schedule: 10 AM outside quiet hours runs");
  ok(todaysRuns(sc, at("2026-10-27T15:00:00Z")).map((r) => r.state).join(",") === "done,next,later", "schedule: today's runs show done / next / later");
  ok(cleanSchedule({ tz: "UTC", times: ["25:00", "09:00", "09:00"] })?.times?.join() === "09:00", "schedule: bad and repeated times are dropped");
}

plannerChecks().then(aiMeterChecks).then(() => {
  console.log(fail ? `\n${fail} failed` : "\nAll checks passed");
  process.exit(fail ? 1 : 0);
});
