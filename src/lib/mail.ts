import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { extractCode } from "./mail-code";
import { classifyMail } from "./mail-classify";
import { cleanCompany } from "./company";
import { parseEventText, parseIcs, type MailEvent } from "@/lib/mail-event";

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
  /** false when the wording suggests a stage but doesn't settle it (confirmed with AI before acting) */
  sure?: boolean;
  code: string | null;
  link: string | null;
  company: string | null;
  event?: MailEvent | null;
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
        : "Could not connect to that mailbox. Check the provider and that IMAP is turned on.",
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
          // Interview time: a calendar invite beats anything we read from the text.
          const ics = (p.attachments || []).find((a) => /text\/calendar|application\/ics/i.test(a.contentType || "") || /\.ics$/i.test(a.filename || ""));
          let event: MailEvent | null = ics ? parseIcs(ics.content.toString("utf8")) : null;
          if (event && ["other", "received", "in_review"].includes(c2.kind) && /interview|call|chat|screen|meet|conversation/i.test(`${subject} ${event.title || ""}`)) {
            // A real calendar invite for a call is the strongest interview signal there is.
            c2.kind = "interview";
            c2.sure = true;
          }
          if (!event && c2.kind === "interview") event = parseEventText(`${subject}\n${text}`, p.date || new Date());
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
            event: c2.kind === "interview" ? event : null,
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
export function classify(fromAddr: string, fromName: string, subject: string, text: string, html: string): { kind: string; sure: boolean; code: string | null; link: string | null; company: string | null } {
  const { kind, sure } = classifyMail(fromAddr, subject, text || html.replace(/<[^>]+>/g, " "));
  const code = kind === "verification" ? extractCode(text || html.replace(/<[^>]+>/g, " ")) : null;
  let link: string | null = null;
  if (kind === "verification") {
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
    const urls = hrefs.length ? hrefs : text.match(/https?:\/\/[^\s<>"')]+/g) || [];
    link = urls.find((u) => /verif|confirm|activate|validate|token|auth|magic|login|signin|sign-in|password/i.test(u) && !/unsubscribe|privacy|help|support/i.test(u)) || null;
  }
  const company = guessCompany(fromAddr, fromName, subject);
  return { kind, sure, code, link, company };
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

/**
 * Which application an email is about. Company names are compared in their clean form
 * ("Datadog Careers | Datadog" → "Datadog"), and the job title can appear in the subject or the body.
 */
export function matchApplication(company: string | null, text: string, apps: { id: string; company: string; title: string; status: string }[]) {
  const hay = `${company || ""} ${text}`.toLowerCase();
  const scored = apps
    .map((a) => {
      const co = cleanCompany(a.company).toLowerCase();
      const hit = co.length > 1 && new RegExp(`\\b${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay);
      const title = a.title.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
      return { a, s: (hit ? 2 : 0) + (title && hay.includes(title) ? 1 : 0) + (["applied", "in_review", "assessment", "interview"].includes(a.status) ? 0.5 : 0) };
    })
    .filter((x) => x.s >= 2)
    .sort((x, y) => y.s - x.s);
  return scored[0]?.a || null;
}
