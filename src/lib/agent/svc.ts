import "server-only";
import { timingSafeEqual } from "crypto";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";

/** Server-side calls that run without a user session (worker, cron). Guarded by the ingest secret in the database. */
export async function rpc<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseAnon().rpc("agent_rpc", { secret: ingestSecret(), op, args });
  if (error) throw new Error(`agent_rpc ${op}: ${error.message}`);
  return data as T;
}

export async function rpcExt<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseAnon().rpc("agent_rpc_ext", { secret: ingestSecret(), op, args });
  if (error) throw new Error(`agent_rpc_ext ${op}: ${error.message}`);
  return data as T;
}

export function agentSecretOk(req: Request) {
  const s = process.env.AGENT_SECRET;
  const got = req.headers.get("x-agent-secret") || "";
  if (!s || s.length < 24 || got.length !== s.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(s));
}

/**
 * Start the browser worker and ask it to work through the queue. Free instances sleep when idle and need
 * ~50s to boot, so the first request is held open long enough for a cold start (short requests just get a 502).
 */
export async function wakeWorker(): Promise<boolean> {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  if (!url || !process.env.AGENT_SECRET) return false;
  const started = Date.now();
  while (Date.now() - started < 100_000) {
    try {
      const h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(90_000), cache: "no-store" });
      if (h.ok) {
        const r = await fetch(`${url}/tick`, { method: "POST", headers: { "x-agent-secret": process.env.AGENT_SECRET }, signal: AbortSignal.timeout(15_000) });
        if (r.ok) return true;
      }
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error("worker did not wake");
  return false;
}

/** Is the worker up right now, and what is it doing? (Never wakes it.) */
export async function workerState(): Promise<{ up: boolean; running?: boolean; current?: { company?: string } | null }> {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  if (!url) return { up: false };
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!r.ok) return { up: false };
    const d = await r.json().catch(() => ({}));
    return { up: true, running: Boolean(d.running), current: d.current || null };
  } catch {
    return { up: false };
  }
}
