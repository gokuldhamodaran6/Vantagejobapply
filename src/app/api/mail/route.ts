import { json, loadUserContext } from "@/lib/server-user";
import { MAIL_PROVIDERS, testMailbox, type MailAccount } from "@/lib/mail";
import { encryptFor, vaultReady } from "@/lib/vault";
import { syncAccount } from "@/lib/agent/mailsync";

export const maxDuration = 90;

/** Connect the dedicated job-search mailbox (Gmail/Yahoo/iCloud/Zoho/IMAP + app password). */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  if (!vaultReady()) return json({ error: "Secure storage isn't configured yet. Try again shortly." }, 503);
  const b = (await req.json().catch(() => ({}))) as { provider?: string; address?: string; password?: string; host?: string; port?: number };
  const provider = MAIL_PROVIDERS[b.provider || "gmail"] ? b.provider || "gmail" : "other";
  const address = (b.address || "").trim().toLowerCase();
  const password = (b.password || "").replace(/\s+/g, "");
  const host = provider === "other" ? (b.host || "").trim() : MAIL_PROVIDERS[provider].host;
  const port = provider === "other" ? Number(b.port) || 993 : MAIL_PROVIDERS[provider].port;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return json({ error: "Enter the full email address." }, 400);
  if (password.length < 8) return json({ error: "Paste the app password (for Gmail it's 16 letters)." }, 400);
  if (!host) return json({ error: "Enter your provider's IMAP server." }, 400);
  if (address === ctx.profile.email.toLowerCase()) {
    // Allowed, but we recommend a separate inbox; nothing to block.
  }
  const test = await testMailbox(address, password, host, port);
  if (!test.ok) return json({ error: test.error }, 400);
  const row = { user_id: ctx.user.id, address, provider, imap_host: host, imap_port: port, secret_enc: encryptFor(ctx.user.id, password), status: "active", error: null, last_uid: 0 };
  const { error } = await ctx.supabase.from("mail_accounts").upsert(row, { onConflict: "user_id" });
  if (error) return json({ error: error.message }, 500);
  const sync = await syncAccount({ ...row } as MailAccount, { days: 14 }).catch(() => ({ inserted: 0 }));
  return json({ ok: true, address, imported: sync.inserted });
}

export async function PUT() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { data } = await ctx.supabase.from("mail_accounts").select("*").eq("user_id", ctx.user.id).maybeSingle();
  if (!data) return json({ error: "Connect your job email first." }, 400);
  const r = await syncAccount(data as MailAccount, { days: 14 });
  return json({ ok: true, imported: r.inserted });
}

export async function DELETE() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  await ctx.supabase.from("mail_accounts").delete().eq("user_id", ctx.user.id);
  return json({ ok: true });
}
