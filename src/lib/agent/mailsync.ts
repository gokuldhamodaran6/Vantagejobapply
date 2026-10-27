import "server-only";
import { decryptFor } from "@/lib/vault";
import { fetchNew, matchApplication, type MailAccount, type ParsedMail } from "@/lib/mail";
import { rpc } from "./svc";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { ask, aiConfigured, extractJson } from "@/lib/ai";
import { runWithAi } from "@/lib/ai-context";
import { nextStatus, type MailKind } from "@/lib/mail-classify";
import { isPublicHost } from "@/lib/net";

const EVENT_TEXT: Record<string, (m: ParsedMail, company: string) => string> = {
  received: (_m, c) => `${c} confirmed they received your application (an automatic receipt, not a reply yet)`,
  action: (m) => `Action needed — the site says your application may not be finished: “${m.subject}”`,
  in_review: (m) => `Under review: “${m.subject}”`,
  assessment: (m) => `Next round — assessment: “${m.subject}”`,
  interview: (m) => `Next round — interview invitation: “${m.subject}”`,
  offer: (m) => `Offer: “${m.subject}”`,
  rejection: (m) => `Not selected: “${m.subject}”`,
};
const STAGES: MailKind[] = ["received", "action", "in_review", "assessment", "interview", "offer", "rejection", "other"];

/**
 * Wording like "we'd love to chat" can be a receipt, a rejection or a real invitation. Before an unsure
 * mail moves an application, AI reads it and names the stage. Without AI, unsure mails only add a note.
 */
async function confirmStage(m: ParsedMail): Promise<{ kind: MailKind; sure: boolean }> {
  const guess = m.kind as MailKind;
  if (m.sure !== false || !["in_review", "assessment", "interview", "offer", "rejection", "received"].includes(guess) || !aiConfigured()) return { kind: guess, sure: m.sure !== false };
  const out = await Promise.race([
    ask(
      `You sort emails a job applicant received from employers. Reply with JSON only: {"stage": one of ${JSON.stringify(STAGES)}}.
- received: confirms the application arrived ("thanks for applying", "we'll be in touch if…"). This is NOT an interview.
- action: the site says the application is not finished or asks the candidate to complete a step or form.
- in_review: a person-written status update that it is being reviewed (not an automatic receipt).
- assessment: asks the candidate to complete a test, challenge, case study or questionnaire.
- interview: a concrete invitation to talk — schedule/book a call, interview, phone screen, or move to the next round.
- offer: a job offer.
- rejection: the company has decided not to move forward. A receipt that only says what happens *if* you're not selected is "received".
- other: anything else (newsletters, job alerts, marketing).`,
      [{ role: "user", content: `From: ${m.from_name} <${m.from_addr}>\nSubject: ${m.subject}\n\n${(m.body || m.snippet || "").slice(0, 3500)}` }],
      60,
      { model: "fast", temperature: 0, feature: "mail-classify" },
    ),
    new Promise<null>((r) => setTimeout(() => r(null), 9000)),
  ]).catch(() => null);
  const stage = extractJson<{ stage?: string }>(out)?.stage as MailKind | undefined;
  return stage && STAGES.includes(stage) ? { kind: stage, sure: true } : { kind: guess, sure: false };
}

// Careers-system senders, matched as whole names so "cleverbridge" or "phenomenal" don't count.
const ATS_SENDER = /(?<![a-z0-9])(greenhouse(-mail)?|lever\.co|ashbyhq|myworkday(jobs)?|workday|icims|taleo|successfactors|smartrecruiters|workable(mail)?|recruitee|jobvite|bamboohr|breezy(hr)?|jazzhr|applytojob|oraclecloud|avature|eightfold|phenompeople|gem\.com|rippling|teamtailor|personio|pinpointhq|dover\.com|hirebridge|paylocity|paycom|ukg(pro)?|ultipro|adp\.com|amazon\.jobs|hirevue|codesignal|hackerrank)(?![a-z])/i;
// Wording that makes a message about a job search.
const JOBISH = /\b(applications?|applied|candidates?|careers?|recruit(er|ers|ing|ment)?|talent|hiring|jobs?|positions?|interviews?|offer letter|requisition)\b/i;

/** A message about the job search: a careers-site email, a code from one, or a reply about one of the person's applications. */
export function isJobMail(
  m: { kind?: string | null; from_addr?: string | null; from_name?: string | null; company?: string | null; subject?: string | null; body?: string | null; snippet?: string | null },
  apps: { id: string; company: string; title: string; status: string }[],
  sites: string[] = [],
) {
  const from = `${m.from_addr || ""} ${m.from_name || ""}`;
  // A code from a site the agent is applying on right now (Amazon's sign-in emails come from amazon.dev, say).
  const domain = (m.from_addr || "").toLowerCase().split("@")[1] || "";
  if (m.kind === "verification" && sites.some((w) => domain.split(/[.-]/).includes(w) || (m.subject || "").toLowerCase().includes(w))) return true;
  if (ATS_SENDER.test(from)) return true;
  if (matchApplication(m.company || null, `${m.subject || ""}\n${(m.body || m.snippet || "").slice(0, 2500)}`, apps)) return true;
  // Codes from banks, shops and other services are never kept: a code counts only when the sender or subject is about jobs.
  if (m.kind === "verification") return JOBISH.test(`${from} ${m.subject || ""}`);
  if (m.kind && m.kind !== "other") return JOBISH.test(`${from} ${m.subject || ""} ${(m.body || m.snippet || "").slice(0, 600)}`);
  return false;
}

/** One identifying word per site/company the agent is applying to now ("amazon", "datadog"). */
async function taskSites(userId: string): Promise<string[]> {
  const { data } = await supabaseAnon().rpc("mail_task_sites", { secret: ingestSecret(), p_user: userId });
  const generic = new Set(["www", "jobs", "careers", "career", "apply", "boards", "job-boards", "greenhouse", "lever", "ashbyhq", "myworkdayjobs", "workday", "inc", "llc", "the", "com", "co", "io"]);
  const words = new Set<string>();
  for (const r of ((data as { host: string; company: string }[] | null) || [])) {
    const parts = (r.host || "").split(".").filter((p) => p && !generic.has(p) && !/^wd[0-9]+$/.test(p));
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (base && base.length > 2) words.add(base);
    const co = (r.company || "").toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 2 && !generic.has(w));
    if (co) words.add(co);
  }
  return [...words];
}

/** Pull new mail for one account, store it, and update matching applications. */
export async function syncAccount(acct: MailAccount, opts: { days?: number } = {}): Promise<{ inserted: number; messages: ParsedMail[] }> {
  if (![993, 143].includes(acct.imap_port) || !(await isPublicHost(acct.imap_host))) {
    await rpc("mail_update", { user_id: acct.user_id, status: "error", error: "Mail server must be a public IMAP server." });
    return { inserted: 0, messages: [] };
  }
  let password: string;
  try {
    password = decryptFor(acct.user_id, acct.secret_enc);
  } catch {
    await rpc("mail_update", { user_id: acct.user_id, status: "error", error: "Saved password can't be read. Reconnect the mailbox." });
    return { inserted: 0, messages: [] };
  }
  try {
    const { messages: all, lastUid } = await fetchNew(acct, password, { days: opts.days ?? 14, max: 80 });
    const apps = all.length ? await rpc<{ id: string; company: string; title: string; status: string }[]>("apps_for_matching", { user_id: acct.user_id }) : [];
    // Only job mail is kept: anything else in the mailbox is never stored and never shown to the AI.
    const sites = all.length ? await taskSites(acct.user_id) : [];
    const messages = all.filter((m) => isJobMail(m, apps || [], sites));
    const confirmed = await runWithAi({ userId: acct.user_id, feature: "mail-classify" }, () => Promise.all(messages.map((m) => confirmStage(m))));
    const rows = messages.map((m, i) => {
      const app = matchApplication(m.company, `${m.subject}\n${(m.body || m.snippet || "").slice(0, 2500)}`, apps || []);
      return { ...m, kind: confirmed[i].kind, sure: confirmed[i].sure, application_id: app?.id || "" };
    });
    const res = rows.length ? await rpc<{ inserted: number }>("inbox_insert", { user_id: acct.user_id, messages: rows }) : { inserted: 0 };
    // Only act on messages that are new to us.
    if (res.inserted) {
      for (const m of rows) {
        const say = EVENT_TEXT[m.kind];
        if (!say || !m.application_id) continue;
        const app = apps.find((a) => a.id === m.application_id);
        if (!app) continue;
        // Unsure wording (no AI to confirm) only adds a note; it never moves the application.
        const next = m.sure === false ? undefined : nextStatus(app.status, m.kind as MailKind);
        await rpc("app_event", { user_id: acct.user_id, application_id: m.application_id, status: next, type: m.kind, text: say(m, app.company) });
        if (next) app.status = next;
      }
    }
    await rpc("mail_update", { user_id: acct.user_id, status: "active", error: null, last_uid: lastUid });
    return { inserted: res.inserted, messages: rows };
  } catch (e) {
    const msg = (e as Error).message || "Mailbox sync failed";
    await rpc("mail_update", { user_id: acct.user_id, status: /auth|credential|password/i.test(msg) ? "error" : "active", error: msg.slice(0, 300) });
    return { inserted: 0, messages: [] };
  }
}

export async function syncAll(deadline: number) {
  const accounts = await rpc<MailAccount[]>("mail_accounts", {});
  let n = 0;
  for (const a of accounts || []) {
    if (Date.now() > deadline) break;
    n += (await syncAccount(a)).inserted;
  }
  return { accounts: accounts?.length || 0, newMessages: n };
}
