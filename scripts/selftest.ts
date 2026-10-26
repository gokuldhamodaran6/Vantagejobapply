// Quick sanity checks for the eligibility engine. Run: npx tsx scripts/selftest.ts
import { matchJob } from "../src/lib/jobs/match";
import { analyzeText } from "../src/lib/jobs/signals";
import { detectCountry } from "../src/lib/jobs/geo";
import { parseResumeText, scoreResume, extractKeywords } from "../src/lib/ats";
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

console.log(fail ? `\n${fail} failed` : "\nAll checks passed");
process.exit(fail ? 1 : 0);
