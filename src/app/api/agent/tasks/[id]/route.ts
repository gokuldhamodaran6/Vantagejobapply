import { json, loadUserContext } from "@/lib/server-user";
import { qkeyOf } from "@/lib/agent/fields";
import { rpc, wakeWorker } from "@/lib/agent/svc";

type Need = { id: string; qkey: string; label: string; type: string; options?: string[] };

/** Approve, cancel, retry, answer the agent's questions, pass a code, or confirm a human check. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; answers?: Record<string, string>; code?: string; alwaysConsent?: boolean };
  const { data: task } = await ctx.supabase.from("agent_tasks").select("*").eq("id", id).maybeSingle();
  if (!task) return json({ error: "Not found" }, 404);

  // Every change is conditional on the state the person saw, so a double tap or a stale card can't
  // restart a job that's already running (or revive one that finished).
  const set = async (patch: Record<string, unknown>, from?: string[]) => {
    let q = ctx.supabase.from("agent_tasks").update(patch).eq("id", id);
    if (from) q = q.in("status", from);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return (data || []).length > 0;
  };
  const moved = () => json({ error: "This job has already moved on — refresh to see where it is now." }, 409);
  const mayBeSent = Boolean(task.submit_clicked_at);

  switch (body.action) {
    case "approve": {
      // Approving a reviewed form: submit exactly what the person saw.
      // Answers are keyed by question + position, exactly as the agent recorded them, so the next run reuses them as-is.
      const review = ((task.needs as (Need & { rkey?: string; value?: string; info?: boolean })[]) || []).filter((n) => n.type === "review" && n.rkey && !n.info);
      const prev = (task.user_input || {}) as Record<string, unknown>;
      const input = ((task.needs as Need[]) || []).some((n) => n.type === "review")
        ? {
            ...prev,
            review_ok: true,
            review_round: Number(prev.review_round || 0) + 1,
            reviewed: { ...((prev.reviewed as Record<string, string>) || {}), ...Object.fromEntries(review.map((n) => [n.rkey!, String(n.value ?? "")])) },
          }
        : task.user_input;
      if (!(await set({ status: "queued", error: null, needs: [], locked_at: null, user_input: input }, ["awaiting_approval"]))) return moved();
      void wakeWorker();
      return json({ ok: true });
    }
    case "retry": {
      // Same checks as "Apply now": never after Submit may have been pressed, never a job already applied to.
      if (mayBeSent) return json({ error: "Submit was already pressed on this one, so it may have been sent. Check your job email for a receipt — if nothing arrives within a day, use “Finish in my browser”." }, 409);
      if (!["failed", "manual", "needs_user"].includes(task.status)) return moved();
      const { data: ok, error } = await ctx.supabase.rpc("apply_now", { p_task: id });
      if (error) return json({ error: error.message }, 409);
      if (!ok) return moved();
      void wakeWorker();
      return json({ ok: true });
    }
    case "apply_now": {
      const { data: ok, error } = await ctx.supabase.rpc("apply_now", { p_task: id });
      if (error) return json({ error: error.message }, 409);
      if (!ok) return json({ error: "This job can't be moved right now." }, 400);
      void wakeWorker();
      return json({ ok: true });
    }
    case "cancel":
      // "running" is allowed: the worker re-checks right before pressing Submit and stops.
      if (!(await set({ status: "cancelled", cancel_reason: "user", finished_at: new Date().toISOString() }, ["queued", "running", "waiting_code", "needs_user", "needs_human", "awaiting_approval", "manual", "failed", "extension"]))) return moved();
      return json({ ok: true });
    case "answers": {
      const needs = (task.needs as Need[]) || [];
      const rows = Object.entries(body.answers || {})
        .map(([fieldId, answer]) => {
          const n = needs.find((x) => x.id === fieldId || x.qkey === fieldId);
          const question = n?.label || fieldId;
          return { user_id: ctx.user.id, qkey: n?.qkey || qkeyOf(question), question, answer: String(answer).slice(0, 4000), kind: n?.type || "text", source: "user", updated_at: new Date().toISOString() };
        })
        .filter((r) => r.answer.trim());
      if (rows.length) {
        const { error } = await ctx.supabase.from("answer_bank").upsert(rows, { onConflict: "user_id,qkey" });
        if (error) return json({ error: error.message }, 500);
      }
      // The user ticked "confirm these standard statements for me": the agent may tick accuracy/privacy/terms boxes from now on.
      if (body.alwaysConsent) {
        const { error } = await ctx.supabase.from("applicant_profiles").upsert({ user_id: ctx.user.id, agent_consent: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (error) console.error("consent save failed", error.message);
      }
      // Agreeing to a careers site's terms for this application lets the agent continue past that page (this time only,
      // unless they also chose "confirm for me on future applications" above).
      const terms = needs.filter((n) => (n as Need & { kind?: string }).kind === "consent");
      const consentAnswered = terms.length > 0 && terms.every((n) => String(body.answers?.[n.id] ?? "").trim() !== "");
      if (!(await set({ status: "queued", needs: [], error: null, locked_at: null, ...(consentAnswered ? { user_input: { ...(task.user_input || {}), terms_ok: true } } : {}) }, ["needs_user"]))) return json({ ok: true, saved: rows.length, note: "Saved — this job had already moved on." });
      void wakeWorker();
      return json({ ok: true, saved: rows.length });
    }
    case "code":
      if (task.status !== "waiting_code") return json({ error: "Your agent is no longer waiting for this code. Tap Retry and it will request a fresh one." }, 409);
      await set({ user_input: { ...(task.user_input || {}), code: String(body.code || "").trim() } });
      return json({ ok: true });
    case "submitted_myself": {
      // A job you filled in your own browser with the extension: you say you submitted it.
      if (task.status !== "extension") return moved();
      await rpc("update", { task_id: id, status: "submitted", step: "Applied", needs: [], log: "You marked it as submitted (filled with the Vantage extension)" });
      const r = await rpc<{ application_id: string } | null>("record_application", { task_id: id, answers: {} });
      if (r?.application_id) {
        const { data: a } = await ctx.supabase.from("applications").select("events").eq("id", r.application_id).maybeSingle();
        const events = ((a?.events as { at: string; type: string; text: string }[]) || []).map((e) => (e.text === "Submitted on the official careers site by your agent" ? { ...e, text: "Submitted by you with the Vantage extension" } : e));
        await ctx.supabase.from("applications").update({ source: "extension", events }).eq("id", r.application_id);
      }
      return json({ ok: true });
    }
    case "human_done":
      await set({ user_input: { ...(task.user_input || {}), human_done: true } });
      return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
