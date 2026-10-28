import { json, loadUserContext } from "@/lib/server-user";
import { isCodeQuestion, isVoluntaryId } from "@/lib/agent/options";
import { qkeyOf, sameMeaning, lockedKind } from "@/lib/agent/fields";
import { wakeWorker } from "@/lib/agent/svc";

type Need = { id: string; qkey: string; label: string; type: string; required?: boolean; kind?: string; live?: boolean; locked?: string };

/**
 * Answer once, for every job that asked: saves the answers to your memory, then puts back in line every job that was
 * waiting only on questions you've now answered. Legal statements match only the exact question; ordinary ones also
 * match the same question in other words.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { answers?: { question: string; answer: string; kind?: string }[] };
  const rows = (body.answers || [])
    .map((a) => ({ user_id: ctx.user.id, qkey: qkeyOf(a.question), question: String(a.question).slice(0, 500), answer: String(a.answer || "").slice(0, 4000), kind: a.kind || "text", source: "user", updated_at: new Date().toISOString() }))
    .filter((r) => r.qkey && r.answer.trim());
  if (!rows.length) return json({ error: "Nothing to save." }, 400);
  const { error } = await ctx.supabase.from("answer_bank").upsert(rows, { onConflict: "user_id,qkey" });
  if (error) return json({ error: error.message }, 500);

  const { data: bank } = await ctx.supabase.from("answer_bank").select("qkey,question");
  const known = (bank as { qkey: string; question: string }[]) || [];
  const answered = (n: Need) => known.some((b) => b.qkey === (n.qkey || qkeyOf(n.label)) || (!n.locked && !lockedKind(n.label.toLowerCase()) && sameMeaning(n.label, b.question || b.qkey)));
  const { data: waiting } = await ctx.supabase.from("agent_tasks").select("id,needs").eq("status", "needs_user");
  let freed = 0;
  for (const t of (waiting as { id: string; needs: Need[] }[]) || []) {
    const needs = t.needs || [];
    if (!needs.length || needs.some((n) => n.live || n.kind === "consent")) continue; // live runs and site terms are answered on their own card
    // One-time code boxes are filled from the mailbox on the next run, never from saved answers.
    // Voluntary self-ID questions are answered "decline" by the agent itself unless you saved an answer.
    if (!needs.every((n) => isCodeQuestion(n.label || "") || (isVoluntaryId(n.label || "") && !n.locked) || answered(n))) continue;
    const { data } = await ctx.supabase.from("agent_tasks").update({ status: "queued", needs: [], error: null, locked_at: null, step: "Back in line — you answered its questions" }).eq("id", t.id).eq("status", "needs_user").select("id");
    if (data?.length) freed++;
  }
  if (freed) void wakeWorker();
  return json({ ok: true, saved: rows.length, freed });
}
