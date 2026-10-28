// Talks to the Vantage app. All decisions (what to type, which answers) are made there; the worker only drives the browser.
const APP = (process.env.APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.AGENT_SECRET || "";

export async function call(op, body = {}) {
  const r = await fetch(`${APP}/api/agent/worker/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `app responded ${r.status}`);
  return j;
}

// Runs handed back during a restart: late status writes from the old run are dropped so they can't undo the hand-back.
const halted = new Set();
export const halt = (taskId) => halted.add(taskId);

export const update = (taskId, patch) =>
  halted.has(taskId) ? Promise.resolve() : call("update", { taskId, ...patch }).catch((e) => console.error("update failed", e.message));
export const log = (taskId, text, step) => update(taskId, { log: text, ...(step ? { step } : {}) });
