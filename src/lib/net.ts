import "server-only";
import { lookup } from "dns/promises";
import { isIP } from "net";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

/** A URL is safe to fetch only if it's http(s), on a normal port, and every address it resolves to is public. */
export async function isSafePublicUrl(raw: string, opts: { httpsOnly?: boolean } = {}): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (opts.httpsOnly ? u.protocol !== "https:" : !["http:", "https:"].includes(u.protocol)) return false;
  if (u.username || u.password) return false;
  if (u.port && !["80", "443", "8443"].includes(u.port)) return false;
  return isPublicHost(u.hostname);
}

export async function isPublicHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || !h.includes(".") && !isIP(h)) return false;
  if (isIP(h)) return !isPrivateIp(h);
  try {
    const addrs = await lookup(h, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** fetch() for user-supplied URLs: public hosts only (checked again on every redirect), with a size cap. */
export async function safeFetch(raw: string, init: RequestInit & { maxBytes?: number; timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; url: string; text: string } | null> {
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    if (!(await isSafePublicUrl(url))) return null;
    const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(init.timeoutMs ?? 15000) }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    const max = init.maxBytes ?? 3_000_000;
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }
    return { ok: res.ok, status: res.status, url, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
  }
  return null;
}

/** Registrable-ish domain ("acme.wd5.myworkdayjobs.com" → "myworkdayjobs.com"; "jobs.example.co.uk" → "example.co.uk"). */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const two = parts.slice(-2).join(".");
  return /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two) && parts.length >= 3 ? parts.slice(-3).join(".") : two;
}
