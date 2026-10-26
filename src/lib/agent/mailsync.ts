import "server-only";
import { decryptFor } from "@/lib/vault";
import { fetchNew, matchApplication, type MailAccount, type ParsedMail } from "@/lib/mail";
import { rpc } from "./svc";
import { ask, aiConfigured, extractJson } from "@/lib/ai";
import { nextStatus, type MailKind } from "@/lib/mail-classify";
import { isPublicHost } from "@/lib/net";

const EVENT_TEXT: Record<string, (m: ParsedMail, company: string) => string> = {
  received: (_m, c) => `${c} confirmed they received your application`,
  in_review: (m) => `Under review: “${m.subject}”`,
  assessment: (m) => `Next round — assessment: “${m.subject}”`,
  interview: (m) => `Next round — interview invitation: “${m.subject}”`,
  offer: (m) => `Offer: “${m.subject}”`,
  rejection: (m) => `Not selected: “${m.subject}”`,
};
const STAGES: MailKind[] = ["received", "in_review", "assessment", "interview", "offer", "rejection", "other"];

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
- in_review: a status update that it is being reviewed.
- assessment: asks the candidate to complete a test, challenge, case study or questionnaire.
- interview: a concrete invitation to talk — schedule/book a call, interview, phone screen, or move to the next round.
- offer: a job offer.
- rejection: the company is not moving forward.
- other: anything else (newsletters, job alerts, marketing).`,
      [{ role: "user", content: `From: ${m.from_name} <${m.from_addr}>\nSubject: ${m.subject}\n\n${(m.body || m.snippet || "").slice(0, 3500)}` }],
      60,
      { model: "fast", temperature: 0 },
    ),
    new Promise<null>((r) => setTimeout(() => r(null), 9000)),
  ]).catch(() => null);
  const stage = extractJson<{ stage?: string }>(out)?.stage as MailKind | undefined;
  return stage && STAGES.includes(stage) ? { kind: stage, sure: true } : { kind: guess, sure: false };
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
    const { messages, lastUid } = await fetchNew(acct, password, { days: opts.days ?? 14, max: 80 });
    const apps = messages.length ? await rpc<{ id: string; company: string; title: string; status: string }[]>("apps_for_matching", { user_id: acct.user_id }) : [];
    const confirmed = await Promise.all(messages.map((m) => confirmStage(m)));
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
