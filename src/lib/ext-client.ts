"use client";
/**
 * Talking to the Vantage Chrome extension from the website. The download from Vantage has a fixed ID (from the
 * public key in its manifest); the Chrome Web Store copy has its own ID (NEXT_PUBLIC_EXT_STORE_ID). Whichever is
 * installed answers.
 */
export const EXT_IDS = [process.env.NEXT_PUBLIC_EXT_STORE_ID, "emeljhngmongcbfjioceeegbfamjdbpn"].filter((x): x is string => Boolean(x));
type ChromeRuntime = { sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: { message?: string } };
const runtime = (): ChromeRuntime | null => (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime || null;

export type ExtReply = { ok?: boolean; connected?: boolean; version?: string; error?: string } | null;

function askOne(id: string, msg: unknown, waitMs: number): Promise<ExtReply> {
  const rt = runtime();
  if (!rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(id, msg, (r) => resolve(rt.lastError ? null : (r as ExtReply) || null));
    } catch {
      resolve(null);
    }
    setTimeout(() => resolve(null), waitMs);
  });
}

/** Ask every known copy; the first that answers (the one installed) wins. */
export async function askExtension(msg: unknown, waitMs = 1500): Promise<ExtReply> {
  for (const id of EXT_IDS) {
    const r = await askOne(id, msg, waitMs);
    if (r) return r;
  }
  return null;
}

export type ExtState = { installed: boolean; connected: boolean; version?: string };
export async function extensionState(): Promise<ExtState> {
  const r = await askExtension({ type: "ping" });
  return { installed: Boolean(r?.ok), connected: Boolean(r?.connected), version: r?.version };
}

/** The newest extension: fills styled dropdowns (Greenhouse 2026 forms), attaches the resume as soon as it's written. */
export const LATEST_EXT = "1.2.1";
export const isLatest = (v?: string) => Boolean(v) && v!.localeCompare(LATEST_EXT, undefined, { numeric: true }) >= 0;

/** Versions before 1.2.0 can't open and fill a job sent from the website. */
export const canOpenFromSite = (v?: string) => Boolean(v) && v!.localeCompare("1.2.0", undefined, { numeric: true }) >= 0;
