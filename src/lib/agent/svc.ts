import "server-only";
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
  return Boolean(s && s.length >= 24 && req.headers.get("x-agent-secret") === s);
}

/** Wake the browser worker (it sleeps when idle on the free plan). Fire-and-forget. */
export function wakeWorker() {
  const url = process.env.WORKER_URL;
  if (!url || !process.env.AGENT_SECRET) return;
  fetch(`${url.replace(/\/$/, "")}/tick`, { method: "POST", headers: { "x-agent-secret": process.env.AGENT_SECRET }, signal: AbortSignal.timeout(8000) }).catch(() => {});
}
