import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomInt } from "crypto";

/**
 * Secrets (mailbox app passwords, career-site logins) are encrypted with AES-256-GCM.
 * Each user gets their own key, derived from VAULT_KEY + their user id, so a database copy alone reveals nothing.
 * Decryption only happens on the server, for that user's own session or for the agent while it applies.
 */
function keyFor(userId: string): Buffer {
  const master = process.env.VAULT_KEY;
  if (!master || master.length < 32) throw new Error("VAULT_KEY is not configured");
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "base64"), Buffer.from(userId), Buffer.from("vantage-vault-v1"), 32));
}

export function vaultReady() {
  return Boolean(process.env.VAULT_KEY && process.env.VAULT_KEY.length >= 32);
}

export function encryptFor(userId: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(userId), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptFor(userId: string, enc: string): string {
  if (!enc?.startsWith("v1:")) throw new Error("Unknown secret format");
  const buf = Buffer.from(enc.slice(3), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", keyFor(userId), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** A strong password that satisfies common employer-portal rules (Workday, iCIMS, Taleo, SuccessFactors). */
export function generatePassword(length = 18): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*?";
  const all = upper + lower + digits + symbols;
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle; never start with a symbol (some portals reject it).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  if (symbols.includes(chars[0])) chars.push(chars.shift()!);
  return chars.join("");
}
