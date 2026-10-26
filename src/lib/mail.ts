import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const MAIL_PROVIDERS: Record<string, { label: string; host: string; port: number; help: string }> = {
  gmail: { label: "Gmail", host: "imap.gmail.com", port: 993, help: "Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords." },
  yahoo: { label: "Yahoo Mail", host: "imap.mail.yahoo.com", port: 993, help: "Account security → Generate app password." },
  icloud: { label: "iCloud Mail", host: "imap.mail.me.com", port: 993, help: "appleid.apple.com → Sign-in and security → App-specific passwords." },
  zoho: { label: "Zoho Mail", host: "imap.zoho.com", port: 993, help: "Zoho account → Security → App passwords (enable IMAP in Zoho Mail settings)." },
  other: { label: "Other (IMAP)", host: "", port: 993, help: "Use your provider's IMAP server and an app password." },
};

export type MailAccount = { user_id: string; address: string; provider: string; imap_host: string; imap_port: number; secret_enc: string; last_uid: number };

export type ParsedMail = {
  msg_id: string;
  uid: number;
  from_addr: string;
  from_name: string;
  subject: string;
  snippet: string;
  body: string;
  received_at: string;
  kind: string;
  code: string | null;
  link: string | null;
  company: string | null;
};

function client(address: string, password: string, host: string, port: number) {
  return new ImapFlow({ host, port, secure: port === 993, auth: { user: address, pass: password.replace(/\s+/g, "") }, logger: false, socketTimeout: 30000, greetingTimeout: 15000 });
}

export async function testMailbox(address: string, password: string, host: string, port: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = client(address, password, host, port);
  try {
    await c.connect();
    await c.mailboxOpen("INBOX", { readOnly: true });
    await c.logout();
    return { ok: true };
  } catch (e) {
    const msg = (e as { responseText?: string; message?: string }).responseText || (e as Error).message || "Could not connect";
    try { await c.logout(); } catch { /* ignore */ }
    return {
      ok: false,
      error: /auth|credential|password|invalid/i.test(msg)
        ? "The email or app password was not accepted. For Gmail, create an app password (not your normal password) with 2-Step Verification turned on."
        : `Could not connect to the mailbox: ${msg}`,
    };
  }
}

/** Fetch new messages since lastUid (or the last `days` days on first sync). Also checks Gmail spam, where verification mail often lands. */
export async function fetchNew(acct: MailAccount, password: string, opts: { days?: number; max?: number } = {}): Promise<{ messages: ParsedMail[]; lastUid: number }> {
  const c = client(acct.address, password, acct.imap_host, acct.imap_port);
  const out: ParsedMail[] = [];
  let lastUid = acct.last_uid || 0;
  await c.connect();
  try {
    const boxes = ["INBOX", ...(acct.imap_host.includes("gmail") ? ["[Gmail]/Spam"] : [])];
    for (const box of boxes) {
      let lock;
      try {
        lock = await c.getMailboxLock(box, { readOnly: true });
      } catch {
        continue;
      }
      try {
        const isInbox = box === "INBOX";
        const since = new Date(Date.now() - (opts.days ?? 7) * 864e5);
        // INBOX: incremental by UID. Spam: last 2 days by date (UIDs differ per mailbox).
        const query = isInbox && lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { since: isInbox ? since : new Date(Date.now() - 2 * 864e5) };
        const uids = ((await c.search(query, { uid: true })) || []).filter((u) => !isInbox || u > lastUid).slice(-(opts.max ?? 60));
        if (!uids.length) continue;
        for await (const m of c.fetch(uids, { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (!m.source) continue;
          const p = await simpleParser(m.source);
          const from = p.from?.value?.[0];
          const text = (p.text || htmlToText(typeof p.html === "string" ? p.html : "")).slice(0, 20000);
          const html = typeof p.html === "string" ? p.html : "";
          const subject = p.subject || "";
          const c2 = classify(from?.address || "", from?.name || "", subject, text, html);
          out.push({
            msg_id: (p.messageId || `${box}:${m.uid}`).slice(0, 300),
            uid: m.uid,
            from_addr: from?.address || "",
            from_name: from?.name || "",
            subject: subject.slice(0, 300),
            snippet: text.replace(/\s+/g, " ").slice(0, 280),
            body: text.slice(0, 8000),
            received_at: (p.date || (m.internalDate instanceof Date ? m.internalDate : new Date())).toISOString(),
            ...c2,
          });
          if (isInbox) lastUid = Math.max(lastUid, m.uid);
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await c.logout().catch(() => {});
  }
  return { messages: out, lastUid };
}

function htmlToText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ");
}

const ATS_SENDERS = /(greenhouse|lever|ashbyhq|myworkday|workday|icims|taleo|successfactors|smartrecruiters|workable|recruitee|jobvite|bamboohr|breezy|jazzhr|oracle|avature|eightfold|phenom|gem\.com|rippling)/i;

/** Decide what an email is and pull out any verification code or link. */
export function classify(fromAddr: string, fromName: string, subject: string, text: string, html: string): { kind: string; code: string | null; link: string | null; company: string | null } {
  const s = `${subject}\n${text}`.toLowerCase();
  let kind = "other";
  if (/verif|confirm your (email|account)|activate your account|one[- ]time|passcode|security code|sign[- ]in code|login code|otp|validate your email/.test(s)) kind = "verification";
  else if (/interview|schedule (a|your) (call|chat|time)|availability|calendly|goodtime|book a time|phone screen|next steps/.test(s) && !/unfortunately/.test(s)) kind = "interview";
  else if (/assessment|coding challenge|hackerrank|codility|codesignal|take-home|online test|hirevue/.test(s)) kind = "assessment";
  else if (/unfortunately|not (be )?moving forward|other candidates|not selected|decided to pursue|regret to inform|position has been filled|will not be proceeding/.test(s)) kind = "rejection";
  else if (/offer letter|pleased to offer|extend (you )?an offer/.test(s)) kind = "offer";
  else if (/thank you for (applying|your application|your interest)|application (has been )?(received|submitted)|we('ve| have) received your application/.test(s)) kind = "received";

  let code: string | null = null;
  if (kind === "verification") {
    const m =
      text.match(/(?:code|passcode|otp|pin|verification)[^0-9A-Z]{0,40}\b([0-9]{4,8})\b/i) ||
      text.match(/\b([0-9]{6})\b/) ||
      text.match(/(?:code|passcode)[^A-Z0-9]{0,20}\b([A-Z0-9]{6,8})\b/);
    if (m && !/^(19|20)\d{2}$/.test(m[1])) code = m[1];
  }
  let link: string | null = null;
  if (kind === "verification") {
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
    const urls = hrefs.length ? hrefs : text.match(/https?:\/\/[^\s<>"')]+/g) || [];
    link = urls.find((u) => /verif|confirm|activate|validate|token|auth|magic|login|signin|sign-in|password/i.test(u) && !/unsubscribe|privacy|help|support/i.test(u)) || null;
  }
  const company = guessCompany(fromAddr, fromName, subject);
  return { kind, code, link, company };
}

function guessCompany(addr: string, name: string, subject: string): string | null {
  const fromSubject = subject.match(/(?:at|with|from|to)\s+([A-Z][\w&.\- ]{1,40}?)(?:[!.,:|-]|$)/)?.[1];
  const cleanName = name.replace(/\b(recruiting|careers|talent( acquisition)?|hiring team|jobs|no-?reply|notifications?|team|hr|via \w+)\b/gi, "").trim();
  const domain = addr.split("@")[1]?.split(".").slice(-2, -1)[0] || "";
  if (cleanName && !ATS_SENDERS.test(cleanName)) return cleanName;
  if (fromSubject) return fromSubject.trim();
  if (domain && !ATS_SENDERS.test(domain) && !/gmail|outlook|yahoo|hotmail/.test(domain)) return domain.charAt(0).toUpperCase() + domain.slice(1);
  return null;
}

export function matchApplication(company: string | null, subject: string, apps: { id: string; company: string; title: string; status: string }[]) {
  const text = `${company || ""} ${subject}`.toLowerCase();
  const scored = apps
    .map((a) => ({ a, s: (text.includes(a.company.toLowerCase()) ? 2 : 0) + (text.includes(a.title.toLowerCase()) ? 1 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((x, y) => y.s - x.s);
  return scored[0]?.a || null;
}
