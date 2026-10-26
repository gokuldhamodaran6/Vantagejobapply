// Network guard: the agent's browser may only talk to public http(s) sites.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const cache = new Map(); // host -> { ok, at }

export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

async function publicHost(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  // Local end-to-end tests only (never set in production).
  if (process.env.AGENT_ALLOW_LOCAL === "1" && process.env.NODE_ENV !== "production" && (h === "127.0.0.1" || h === "localhost")) return true;
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h === "metadata.google.internal") return false;
  if (isIP(h)) return !isPrivateIp(h);
  const c = cache.get(h);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.ok;
  let ok = false;
  try {
    const addrs = await lookup(h, { all: true, verbatim: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    ok = false;
  }
  cache.set(h, { ok, at: Date.now() });
  return ok;
}

/** Allowed: public http(s), plus inert in-page schemes. Everything else (file:, chrome:, internal hosts) is blocked. */
export async function allowedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (["data:", "blob:", "about:"].includes(u.protocol)) return true;
  if (!["http:", "https:"].includes(u.protocol)) return false;
  if (u.username || u.password) return false;
  if (u.port && !["80", "443", "8443"].includes(u.port) && !(process.env.AGENT_ALLOW_LOCAL === "1" && process.env.NODE_ENV !== "production")) return false;
  return publicHost(u.hostname);
}

export function baseDomain(host) {
  const parts = String(host).toLowerCase().replace(/^www\./, "").split(".");
  const two = parts.slice(-2).join(".");
  return /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two) && parts.length >= 3 ? parts.slice(-3).join(".") : two;
}
