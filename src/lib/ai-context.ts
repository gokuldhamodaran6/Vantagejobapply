import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who an AI call is for, and what it's for — carried through async code so src/lib/ai.ts can attribute usage
 * without every function passing it along.
 *
 *   await runWithAi({ userId, feature: "tailor" }, () => tailorForJob(...))
 *
 * Nested runs inherit what the outer run set and override only what they name. tagAi() fills in details
 * learnt later in the same run (e.g. the user, once the task is loaded).
 */
export type AiCtx = { userId?: string | null; feature?: string | null; taskId?: string | null };

const als = new AsyncLocalStorage<AiCtx>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(ctx: AiCtx): AiCtx {
  const out: AiCtx = {};
  if (ctx.userId !== undefined) out.userId = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
  if (ctx.taskId !== undefined) out.taskId = ctx.taskId && UUID.test(ctx.taskId) ? ctx.taskId : null;
  if (ctx.feature) out.feature = String(ctx.feature).slice(0, 40);
  return out;
}

export function runWithAi<T>(ctx: AiCtx, fn: () => T): T {
  return als.run({ ...(als.getStore() || {}), ...clean(ctx) }, fn);
}

/** Add details to the current run (no-op outside runWithAi). */
export function tagAi(patch: AiCtx) {
  const s = als.getStore();
  if (s) Object.assign(s, clean(patch));
}

export function aiCtx(): AiCtx {
  return als.getStore() || {};
}
