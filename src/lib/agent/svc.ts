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
 * Wake the browser worker (on the free plan it sleeps when idle) and ask it to work through the queue.
 * A GET wakes a sleeping instance; the POST then starts the queue. Retries a few times while it boots.
 */
export async function wakeWorker(): Promise<boolean> {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  if (!url || !process.env.AGENT_SECRET) return false;
  for (let i = 0; i < 4; i++) {
    try {
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      const r = await fetch(`${url}/tick`, { method: "POST", headers: { "x-agent-secret": process.env.AGENT_SECRET }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return true;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
  }
  console.error("worker did not wake");
  return false;
}
