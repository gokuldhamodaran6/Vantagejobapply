import "server-only";
import { decryptFor } from "@/lib/vault";
import { fetchNew, matchApplication, type MailAccount, type ParsedMail } from "@/lib/mail";
import { rpc } from "./svc";

const KIND_TO_STATUS: Record<string, { status?: string; text: (m: ParsedMail) => string }> = {
  received: { text: (m) => `Company confirmed your application (“${m.subject}”)` },
  interview: { status: "interview", text: (m) => `Interview request: “${m.subject}”` },
  assessment: { status: "in_review", text: (m) => `Assessment sent: “${m.subject}”` },
  rejection: { status: "rejected", text: (m) => `Company replied: “${m.subject}”` },
  offer: { status: "offer", text: (m) => `Offer: “${m.subject}”` },
};

/** Pull new mail for one account, store it, and update matching applications. */
export async function syncAccount(acct: MailAccount, opts: { days?: number } = {}): Promise<{ inserted: number; messages: ParsedMail[] }> {
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
    const rows = messages.map((m) => {
      const app = matchApplication(m.company, m.subject, apps || []);
      return { ...m, application_id: app?.id || "" };
    });
    const res = rows.length ? await rpc<{ inserted: number }>("inbox_insert", { user_id: acct.user_id, messages: rows }) : { inserted: 0 };
    // Only act on messages that are new to us.
    if (res.inserted) {
      for (const m of rows) {
        const rule = KIND_TO_STATUS[m.kind];
        if (!rule || !m.application_id) continue;
        const app = apps.find((a) => a.id === m.application_id);
        // Never move an application backwards (e.g. a late "received" after an interview).
        const order = ["saved", "ready", "applied", "in_review", "interview", "offer", "rejected"];
        const next = rule.status && app && order.indexOf(rule.status) > order.indexOf(app.status) ? rule.status : undefined;
        await rpc("app_event", { user_id: acct.user_id, application_id: m.application_id, status: next, type: m.kind, text: rule.text(m) });
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
