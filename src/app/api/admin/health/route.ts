import { json, loadUserContext } from "@/lib/server-user";

export const dynamic = "force-dynamic";

/** System health for the admin: the database snapshot plus a live check of the agent worker. */
export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx || ctx.profile.role !== "admin") return json({ error: "forbidden" }, 403);
  const [snap, worker] = await Promise.all([
    ctx.supabase.rpc("admin_health").then((r) => r.data as Record<string, unknown> | null, () => null),
    probeWorker(),
  ]);
  return json({
    ...(snap || {}),
    worker,
    email: { configured: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL), to: process.env.ALERT_EMAIL ? process.env.ALERT_EMAIL.replace(/(^.).*(@.*$)/, "$1…$2") : null },
  });
}

async function probeWorker() {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  if (!url) return { state: "not configured" };
  const t0 = Date.now();
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { running?: boolean; current?: { company?: string } | null; done?: number };
    return r.ok ? { state: d.running ? "working" : "idle", ms: Date.now() - t0, current: d.current?.company || null, done: d.done ?? null } : { state: `error ${r.status}`, ms: Date.now() - t0 };
  } catch {
    // The free instance sleeps when idle and wakes (~50 s) on the next job.
    return { state: "asleep or unreachable", ms: Date.now() - t0 };
  }
}
