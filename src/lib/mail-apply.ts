/**
 * Reading application confirmations from any site — LinkedIn Easy Apply, Indeed, Workday, Greenhouse, Lever, Ashby,
 * iCIMS, SmartRecruiters, Taleo or a company's own careers site — so the tracker fills itself from the inbox.
 *
 * Pure functions only (no server imports): used by the mail sync, the tests and the Applications page.
 *
 *   receiptVerdict(mail, kind)  is this an application receipt, or a job alert / newsletter / outreach / rejection?
 *   parseAppliedJob(mail)       { company, title, url, board } read from the subject and body — never invented
 *   followUpDraft(app)          a short, polite follow-up email the person sends themselves
 */

export type MailLike = { from_addr?: string | null; from_name?: string | null; subject?: string | null; body?: string | null; snippet?: string | null };
export type AppliedJob = { company: string | null; title: string | null; url: string | null; board: string | null };

/** Words that are never a company on their own: job boards, careers systems, mail providers, mailbox names. */
const NOT_COMPANY = new Set([
  "linkedin", "indeed", "glassdoor", "ziprecruiter", "monster", "dice", "handshake", "wellfound", "angellist", "simplify", "otta", "builtin", "hired",
  "greenhouse", "lever", "ashby", "ashbyhq", "workday", "myworkday", "myworkdayjobs", "myworkdaysite", "icims", "taleo", "oracle", "oraclecloud", "successfactors", "sap",
  "smartrecruiters", "workable", "workablemail", "recruitee", "jobvite", "bamboohr", "breezy", "breezyhr", "jazzhr", "jazz", "applytojob", "avature", "eightfold",
  "phenom", "phenompeople", "rippling", "teamtailor", "personio", "paylocity", "paycom", "ukg", "ultipro", "adp", "hirevue", "gem", "dover", "pinpoint", "pinpointhq",
  "gmail", "googlemail", "google", "outlook", "hotmail", "live", "yahoo", "icloud", "me", "aol", "proton", "protonmail", "mail", "email",
  "noreply", "no", "reply", "donotreply", "do", "not", "notifications", "notification", "alerts", "alert", "info", "hello", "hi",
  "careers", "career", "jobs", "job", "talent", "acquisition", "recruiting", "recruitment", "recruiter", "hr", "people", "team", "hiring", "hire", "us", "the",
  "application", "applications", "candidate", "candidates", "apply", "system", "admin", "support", "via", "at", "and", "on", "behalf", "of",
]);
const BOARDS: [RegExp, string][] = [
  [/linkedin\.com$/i, "LinkedIn"], [/indeed\.com$/i, "Indeed"], [/glassdoor\.com$/i, "Glassdoor"], [/ziprecruiter\.com$/i, "ZipRecruiter"],
  [/wellfound\.com$|angel\.co$/i, "Wellfound"], [/joinhandshake\.com$/i, "Handshake"], [/dice\.com$/i, "Dice"], [/monster\.com$/i, "Monster"],
];
const ATS_DOMAIN = /(greenhouse(-mail)?\.io|lever\.co|ashbyhq\.com|myworkday(jobs)?\.com|myworkdaysite\.com|workday\.com|icims\.com|taleo\.net|oraclecloud\.com|successfactors\.(com|eu)|smartrecruiters\.com|workablemail\.com|workable\.com|recruitee\.com|jobvite\.com|bamboohr\.com|breezy\.hr|applytojob\.com|avature\.net|eightfold\.ai|phenompeople\.com|rippling\.com|teamtailor(-mail)?\.com|personio\.(de|com)|paylocity\.com|paycomonline\.net|ultipro\.com|adp\.com|hirevue\.com|gem\.com|dover\.com|pinpointhq\.com)$/i;
const FREEMAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|mail|gmx|zoho)$/i;

/** Words a job title is usually built from — used to accept a title read by the loosest patterns. */
const ROLE_WORD = /\b(engineer|engineering|developer|analyst|analytics|manager|designer|scientist|specialist|associate|coordinator|consultant|intern|internship|director|lead|architect|administrator|admin|officer|representative|rep|assistant|technician|accountant|writer|editor|researcher|strategist|planner|advisor|adviser|executive|programmer|tester|qa|sre|devops|product|sales|marketing|support|operations|recruiter|nurse|teacher|tutor|clerk|cashier|driver|agent|partner|head|vp|principal|staff|senior|junior|sr|jr|fellow|trainee|apprentice|graduate|owner|expert|generalist|counsel|attorney|paralegal|controller|auditor|economist|statistician|investigator|instructor|coach|therapist|pharmacist|physician|chef|cook|mechanic|electrician|operator|supervisor|buyer|producer|animator|artist|photographer|data|software|security|finance|financial|customer|success|business|project|program|account)s?\b/i;

const RECEIPT_SUBJECT = /thank(s| you)( so much)? for (applying|your application|submitting|your interest in (the |our )?[^\n]{0,80}\b(position|role|opening|job)\b)|application (has been |was |is )?(received|submitted|confirmation|sent|complete|confirmed)|your application (was |has been )?(sent|submitted|received|to|for)\b|we('ve| have) received your (application|resume)|indeed application:|you applied (to|for)|successfully (applied|submitted)|applied (to|for) .{1,80} (at|with)\b/i;
const JOB_ALERT = /jobs? you (may|might) (be interested in|like)|recommended (jobs|for you|roles)|new jobs? (for you|that match|matching|in |near |at |posted)|\bjob alerts?\b|jobs? (matching|that match) your|based on your (profile|preferences|search|job alert|recent)|(is|are) hiring\b|people (also )?(viewed|applied)|top job picks|we found \d+|\b\d+\+? new (jobs|roles|openings)|similar jobs|jobs similar to|your (daily|weekly) (job|digest)|saved search|be an early applicant|apply now to|new opportunities (for you|matching)|roles you might like|recommended for you/i;
const NEWSLETTER = /newsletter|webinar|\bdigest\b|career (advice|tips)|tips for your job search|weekly roundup|\d+% off|premium (free )?trial|try premium|upgrade to premium|who viewed your profile|profile views|your network|invitation to connect|endorse/i;
const OUTREACH = /came across your (profile|resume|background|experience)|(would|are) you (be )?(interested|open) (in|to)\b|i('m| am) (a |the )?(recruiter|recruiting|talent)|reaching out (to you )?(about|regarding|because|with)|quick (chat|call) about (a|an|this) (role|opportunity|position)|exciting (new )?opportunity|i have a (role|position|client|opening)|\bmy client\b|open to new (roles|opportunities)|your background (looks|seems|is)/i;
const REJECTION = /unfortunately|not (to )?(be )?moving forward|move forward with other|other candidates|not been selected|not selected|regret to inform|position has been filled|will not be proceeding|won['’]t be proceeding|no longer (being )?considered/i;

const one = (s: string | null | undefined) => (s || "").replace(/[ \t ]+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Is this mail an application receipt (create/confirm an application) rather than a job alert, newsletter,
 * recruiter outreach or rejection? `kind` is what classifyMail (or the AI check) said; `sure` is its confidence.
 */
export function receiptVerdict(m: MailLike, kind: string, sure: boolean = true): { receipt: boolean; reason: string } {
  const subject = one(m.subject).trim();
  const head = `${subject}\n${one(m.body || m.snippet).slice(0, 1500)}`;
  if (["rejection", "offer", "verification", "action"].includes(kind)) return { receipt: false, reason: kind };
  if (REJECTION.test(withoutIfs(head))) return { receipt: false, reason: "rejection" };
  if (JOB_ALERT.test(subject) || NEWSLETTER.test(subject)) return { receipt: false, reason: "job alert or newsletter" };
  const strongSubject = RECEIPT_SUBJECT.test(subject);
  // Receipts (LinkedIn's in particular) end with "similar jobs" lists, so the body only counts against a weak subject.
  if (!strongSubject && (JOB_ALERT.test(head) || NEWSLETTER.test(head))) return { receipt: false, reason: "job alert or newsletter" };
  if (!strongSubject && OUTREACH.test(head)) return { receipt: false, reason: "recruiter outreach" };
  if (kind === "received") return { receipt: true, reason: "receipt" };
  // Wording that only *suggested* a later stage ("you may be asked to complete an assessment") under a receipt subject.
  if (strongSubject && (kind === "other" || (sure === false && ["in_review", "assessment", "interview"].includes(kind)))) return { receipt: true, reason: "receipt subject" };
  return { receipt: false, reason: "not a receipt" };
}

export function isApplicationReceipt(m: MailLike, kind: string, sure: boolean = true) {
  return receiptVerdict(m, kind, sure).receipt;
}

function withoutIfs(s: string) {
  return s.split(/(?<=[.!?\n])\s+/).filter((x) => !/\b(if|should|in the event|in case|unless)\b/i.test(x)).join(" ");
}

/** "Senior Data Analyst (R12345) position" → "Senior Data Analyst". Returns null when it doesn't read like a job title. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = one(raw).replace(/\n/g, " ").trim();
  t = t.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  t = t.replace(/^(?:the|our|a|an)\s+/i, "").replace(/^(?:position|role|job) of\s+/i, "");
  t = t.replace(/\s*\((?:[^)]*\b(?:req|requisition|job|id|number|no\.?|ref)\b[^)]*|[A-Z]{0,4}[-_ ]?\d{3,}[^)]*)\)/gi, "");
  t = t.replace(/\s*[-–—|#]\s*(?:(?:req(?:uisition)?|job)\s*)?(?:id|#|no\.?|number)?\s*:?\s*[A-Z]{0,4}[-_]?\d{3,}[\w-]*\s*$/i, "");
  t = t.replace(/\s*\b(?:position|role|opening|job|vacancy|opportunity)\s*$/i, "");
  t = t.replace(/^["“'‘]+|["”'’]+$/g, "").replace(/[\s.,:;!\-–—]+$/, "").trim();
  return looksLikeTitle(t) ? t : null;
}

export function looksLikeTitle(t: string) {
  if (t.length < 2 || t.length > 100) return false;
  if (t.split(/\s+/).length > 12 || !/[a-z]/i.test(t) || /https?:|www\.|@/.test(t)) return false;
  return !/\b(thank|thanks|received|receive|application|applying|applied|your|you|we|our|us|interest|submitted|please|click|here|confirm|congratulations|status|update)\b/i.test(t);
}

/** The run of capitalised words a company name is made of: "Acme Corp. We will…" → "Acme Corp". */
function capRun(s: string): string {
  const words = s.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < 7; i++) {
    const w = words[i].replace(/^[("“'‘]+/, "");
    const linker = /^(of|de|du|la|le|von|van|der|for|&|\+)$/.test(w) && out.length > 0 && /^[A-Z0-9]/.test(words[i + 1] || "");
    if (!(/^[A-Z0-9]/.test(w) || linker)) break;
    out.push(w);
    if (/[.!?,;:)"”]$/.test(w) && !/^(inc|co|corp|ltd|llc|st|bros)\.$/i.test(w)) break;
  }
  return out.join(" ").replace(/[.!?,;:)"”'’]+$/, "").trim();
}

/** A company name, or null when it is a job board, careers system or mailbox word ("LinkedIn", "Workday", "Careers"). */
export function cleanCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let c = capRun(one(raw).replace(/\n[\s\S]*/, "")) || "";
  c = c.replace(/\s*[|·–—-]\s*.*$/, "").trim();
  c = c.replace(/\b(careers?|jobs?|recruiting|recruitment|talent( acquisition)?( team)?|hiring( team)?|people( team)?|hr|team|workday|via \w+|notifications?|no-?reply)\b/gi, "").replace(/\s+/g, " ").replace(/[\s,&-]+$/, "").trim();
  if (c.length < 2 || c.length > 60) return null;
  const words = c.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.every((w) => NOT_COMPANY.has(w))) return null;
  if (/^(the|our|this|a|an|your)\b/i.test(c) && /\b(position|role|job|opportunity|team)\b/i.test(c)) return null;
  if (/\b(position|role|opportunity|application)\b/i.test(c)) return null;
  return c;
}

function boardOf(addr: string): string | null {
  const domain = (addr.split("@")[1] || "").toLowerCase();
  return BOARDS.find(([re]) => re.test(domain))?.[1] || null;
}

/** The company the mail came from, read from the sender: "Acme Recruiting" <x@myworkday.com>, careers@stripe.com. */
function companyFromSender(addr: string, name: string): string | null {
  if (boardOf(addr)) return null;
  const n = cleanCompanyName(name.replace(/@\s*\w+/g, " "));
  if (n) return n;
  const [local = "", domain = ""] = addr.toLowerCase().split("@");
  const parts = domain.split(".");
  // Workday sends from <company>@myworkday.com; iCIMS from careers-<company>@icims.com.
  if (ATS_DOMAIN.test(domain)) {
    const w = local.split(/[^a-z0-9]+/).find((x) => x.length > 2 && !NOT_COMPANY.has(x));
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
  }
  const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (base && base.length > 1 && !FREEMAIL.test(base) && !NOT_COMPANY.has(base)) return base.charAt(0).toUpperCase() + base.slice(1);
  return null;
}

function jobUrl(text: string, board: string | null): string | null {
  const li = text.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d{6,})/i);
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}/`;
  const ind = text.match(/indeed\.com\/[^\s"'<>]*?[?&]jk=([0-9a-f]{8,})/i);
  if (ind) return `https://www.indeed.com/viewjob?jk=${ind[1]}`;
  if (board) return null;
  const urls = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const posting = urls.find((u) => /(boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|myworkdayjobs\.com|icims\.com\/jobs|jobs\.smartrecruiters\.com|taleo\.net\/careersection)\/[^\s]*\d/i.test(u) && !/unsubscribe|privacy|preferences/i.test(u));
  return posting ? posting.replace(/[.,;]+$/, "") : null;
}

const T = `([A-Za-z0-9][^\\n!?;"“”<>|]{1,90}?)`;
const ROLEWORD = `(?:position|role|opening|job|vacancy|opportunity|requisition)`;
const PAREN = `(?:\\s*\\([^)\\n]{0,40}\\))?`;
const STOP = `(?=\\s*(?:\\(|[.!;]\\s|[.!;]?\\s*$|,\\s|\\n| and | has | have | is | was | we | at | with | in | here))`;

/** Read the company, job title and posting link from an application receipt. Unknown parts are null — never guessed. */
export function parseAppliedJob(m: MailLike): AppliedJob {
  const addr = (m.from_addr || "").trim();
  const name = one(m.from_name).trim();
  const subject = one(m.subject).replace(/\s+/g, " ").trim();
  const raw = (m.body || m.snippet || "").replace(/\r/g, "");
  const body = one(raw).replace(/([^\n.!?:])\n(?=[a-z])/g, "$1 ").slice(0, 6000);
  const board = boardOf(addr);
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  let company: string | null = null;
  let title: string | null = null;

  const take = (t?: string | null, c?: string | null) => {
    if (!title && t) title = cleanTitle(t);
    if (!company && c) company = cleanCompanyName(c);
  };

  if (board === "LinkedIn") {
    take(null, subject.match(/application was sent to\s+(.+)$/i)?.[1] || body.match(/application was sent to\s+([^\n]+)/i)?.[1]);
    if (company) {
      const co = esc(company);
      // "Software Engineer, Payments" above "Stripe · San Francisco, CA (Hybrid)"
      const at = lines.findIndex((l) => new RegExp(`^${co}\\b[^\\n]*\\s[·•]\\s`, "i").test(l));
      for (let j = at - 1; at > 0 && j >= 0 && !title; j--) {
        const l = lines[j];
        if (new RegExp(`^${co}$`, "i").test(l) || /application was sent|^https?:|^view job|^\W*$/i.test(l)) continue;
        title = cleanTitle(l);
        break;
      }
      if (!title) take(lines.map((l) => l.match(new RegExp(`^(.+?)\\s[·•]\\s${co}\\b`, "i"))?.[1]).find(Boolean));
    }
  }
  if (board === "Indeed") {
    take(subject.match(/indeed application:\s*(.+)$/i)?.[1], body.match(/(?:items were sent to|application (?:has been |was )?(?:sent|submitted) to)\s+([^\n]+)/i)?.[1]);
    const at = lines.findIndex((l) => /^application submitted$/i.test(l));
    if (at >= 0) take(lines[at + 1], lines[at + 2]?.split(/\s[-–]\s/)[0]);
  }

  // Sentences used by Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, Taleo and careers sites.
  const sentence: { re: RegExp; t?: number; c?: number }[] = [
    // "applying for the Senior Data Analyst (R12345) position at Acme"
    { re: new RegExp(`(?:applying|applied|application|interest|considering you)\\s+(?:for|to|in)\\s+(?:the\\s+|our\\s+|a\\s+|an\\s+)?["“']?${T}["”']?${PAREN}\\s+${ROLEWORD}\\b${PAREN}(?:\\s+(?:at|with)\\s+([^\\n]{2,80}))?`, "i"), t: 1, c: 2 },
    // "Thank you for applying to Senior Analyst at Acme" / "Your application for Marketing Manager at Acme"
    { re: new RegExp(`(?:applying|applied|application|interest)\\s+(?:for|to|in)\\s+(?:the\\s+)?["“']?${T}["”']?${PAREN}\\s+(?:at|with)\\s+([^\\n]{2,80})`, "i"), t: 1, c: 2 },
    // "your application to Acme for the Product Designer position"
    { re: new RegExp(`(?:application|applying|applied)\\s+(?:to|with|at)\\s+([^\\n]{2,60}?)\\s+(?:for|as)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:position\\s+of\\s+)?["“']?${T}["”']?${STOP}`, "i"), c: 1, t: 2 },
    // "Application received: Financial Analyst (Job Number 123)" / "Indeed Application: Data Analyst"
    { re: /(?:application (?:received|submitted|confirmation|sent)|your application(?: for)?)\s*[:–—-]\s*([^\n]{2,100})$/i, t: 1 },
  ];
  for (const src of [subject, body.slice(0, 2500)]) {
    for (const p of sentence) {
      const x = src.match(p.re);
      if (!x) continue;
      const t = p.t ? cleanTitle(x[p.t]) : null;
      if (p.t && !t) continue;
      take(t, p.c ? x[p.c] : null);
    }
  }
  // Loosest: "received your application for Product Designer and …" — only when it reads like a job title.
  if (!title) {
    const x = `${subject}\n${body.slice(0, 2500)}`.match(new RegExp(`(?:application|applying|applied)\\s+for\\s+(?:the\\s+|our\\s+)?(?:position\\s+of\\s+)?["“']?${T}["”']?${STOP}`, "i"));
    const t = cleanTitle(x?.[1]);
    if (t && ROLE_WORD.test(t)) title = t;
  }
  // Company: "Thank you for applying to Acme!", "Acme - Application received", "Thank you for applying – Acme".
  if (!company) {
    for (const src of [subject, body.slice(0, 2500)]) {
      const x = src.match(/(?:thank(?:s| you)(?: so much)? for (?:applying|your application|your interest)|applied|application(?: was sent| has been sent| submitted)?)\s+(?:to|at|with|in)\s+(?:join(?:ing)?\s+)?(?:the\s+)?([^\n]{2,80})/i)
        || src.match(/^thank(?:s| you) for (?:applying|your application)\s*[–—|:-]\s*([^\n]{2,60})$/i)
        || src.match(/^([^\n:|–—-]{2,50}?)\s*[–—|:-]\s*(?:application|thank|your application)/i);
      const c = cleanCompanyName(x?.[1]);
      if (c && !(title && c.toLowerCase() === (title as string).toLowerCase())) { company = c; break; }
    }
  }
  if (!company) company = companyFromSender(addr, name);
  if (title && company && (title as string).toLowerCase() === (company as string).toLowerCase()) title = null;
  return { company, title, url: jobUrl(raw, board), board };
}

/** The title to show when the email didn't say which role it was. The application is marked so the person can confirm it. */
export function placeholderTitle(company: string | null) {
  return `Role at ${company || "a company"}`;
}

/** Who sent it, for the timeline: "LinkedIn", "Acme via Workday", "careers@stripe.com". */
export function senderLabel(m: MailLike, company: string | null): string {
  const addr = (m.from_addr || "").toLowerCase();
  const board = boardOf(addr);
  if (board) return board;
  const domain = addr.split("@")[1] || "";
  const ats = domain.match(/greenhouse|lever|ashby|workday|icims|taleo|smartrecruiters|workable|jobvite|bamboohr|successfactors|oraclecloud/)?.[0];
  const names: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", icims: "iCIMS", taleo: "Taleo", smartrecruiters: "SmartRecruiters", workable: "Workable", jobvite: "Jobvite", bamboohr: "BambooHR", successfactors: "SuccessFactors", oraclecloud: "Oracle" };
  if (ats) return company ? `${company} via ${names[ats]}` : names[ats];
  return one(m.from_name).trim() || addr || company || "the company";
}

// ——— Follow-up nudges (Applications page) ———

export const FOLLOW_UP_DAYS = 10;
type AppLike = { status: string; applied_at: string | null; created_at: string; events?: { at: string; type: string }[] | null };

/** Days since the person applied when an application has had no reply for 10+ days (and no follow-up in that time); otherwise null. */
export function followUpDue(a: AppLike, now: number = Date.now()): number | null {
  if (a.status !== "applied") return null;
  const start = Date.parse(a.applied_at || a.created_at);
  if (!Number.isFinite(start)) return null;
  const lastNudge = Math.max(0, ...(a.events || []).filter((e) => e.type === "follow_up").map((e) => Date.parse(e.at) || 0));
  const quiet = Math.floor((now - Math.max(start, lastNudge)) / 864e5);
  return quiet >= FOLLOW_UP_DAYS ? Math.floor((now - start) / 864e5) : null;
}

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A short, polite follow-up the person copies and sends from their own mailbox. */
export function followUpDraft(a: { company: string; title: string; titleGuess?: boolean; appliedAt?: string | null; name?: string | null }): { subject: string; body: string } {
  const role = a.titleGuess ? "" : a.title.trim();
  const d = a.appliedAt ? new Date(a.appliedAt) : null;
  const when = d && Number.isFinite(d.getTime()) ? ` on ${MONTH[d.getMonth()]} ${d.getDate()}` : "";
  const subject = role ? `Following up on my application: ${role}` : `Following up on my application to ${a.company}`;
  const body = [
    `Hi ${a.company} hiring team,`,
    "",
    `I applied for ${role ? `the ${role} role` : `a role at ${a.company}`}${when} and wanted to follow up. I'm still very interested and would be glad to share anything else that helps with your review.`,
    "",
    "Is there an update on the timeline, or anything else you need from me?",
    "",
    "Thank you for your time,",
    a.name?.trim() || "[Your name]",
  ].join("\n");
  return { subject, body };
}
