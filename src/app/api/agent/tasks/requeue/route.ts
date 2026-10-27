import { json, loadUserContext } from "@/lib/server-user";
import { wakeWorker } from "@/lib/agent/svc";
import { dailyLimit, PER_EMPLOYER_30D, recentByEmployer } from "@/lib/access";
import { normCompany } from "@/lib/jobs/signals";
import { limitDayStart } from "@/lib/agent/plan";

type Row = { id: string; title: string; company: string; status: string; why: string | null };

async function preview(ctx: NonNullable<Awaited<ReturnType<typeof loadUserContext>>>) {
  const { data, error } = await ctx.supabase.rpc("retry_preview");
  if (error) throw new Error(error.message);
  const rows = (data as Row[]) || [];
  // The 3-per-employer-a-month promise applies to retries too.
  const perEmployer = await recentByEmployer(ctx.supabase);
  for (const r of rows) {
    if (r.why) continue;
    const co = normCompany(r.company);
    const n = perEmployer.get(co) || 0;
    if (n >= PER_EMPLOYER_30D) r.why = `Already ${PER_EMPLOYER_30D} applications to ${r.company} this month`;
    else perEmployer.set(co, n + 1);
  }
  return rows;
}

/** Which jobs that didn't finish can be retried safely, and why the rest can't. Read-only. */
export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  try {
    const rows = await preview(ctx);
    return json({ safe: rows.filter((r) => !r.why), held: rows.filter((r) => r.why) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

/**
 * Retry only the jobs that stopped before anything was sent: never ones you skipped, never ones where Submit may
 * have been pressed, never a job (or the same role) you already applied to — within today's limit.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const dayStart = new Date(limitDayStart()).toISOString();
  const [{ count: usedToday }, { count: inLine }] = await Promise.all([
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).gte("created_at", dayStart).neq("status", "extension").not("started_at", "is", null),
    ctx.supabase.from("agent_tasks").select("id", { count: "exact", head: true }).in("status", ["queued", "running", "waiting_code", "needs_human"]),
  ]);
  const limit = dailyLimit(ctx.profile as { daily_limit?: number; high_volume_ok?: boolean }, ctx.plan);
  const room = Math.max(0, limit - (usedToday || 0) - (inLine || 0));
  if (!room) return json({ error: `You've reached today's limit of ${limit} applications. The rest can go tomorrow — or raise your daily limit in Settings.` }, 429);
  const rows = await preview(ctx).catch(() => null);
  if (!rows) return json({ error: "Couldn't check these jobs right now." }, 500);
  const want = new Set(body.ids || []);
  const ids = rows.filter((r) => !r.why && (!want.size || want.has(r.id))).map((r) => r.id).slice(0, room);
  if (!ids.length) return json({ ok: true, queued: 0, held: rows.filter((r) => r.why).length });
  const { data: n, error } = await ctx.supabase.rpc("requeue_tasks", { p_ids: ids });
  if (error) return json({ error: error.message }, 500);
  void wakeWorker();
  return json({ ok: true, queued: n || 0, capped: rows.filter((r) => !r.why).length > room });
}
