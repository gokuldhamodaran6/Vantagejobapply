import { extJson, extUser, ownTask } from "@/lib/ext";
import { loadBundle } from "@/lib/agent/bundle";
import { cleanSnapshot, pilotCtx, pilotStep, type PilotHistory } from "@/lib/agent/pilot";

export const maxDuration = 90;

/** One step of the form pilot for the Chrome extension: here's the page, what should happen next? */
export async function POST(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  if (Number(req.headers.get("content-length") || 0) > 2_000_000) return extJson({ error: "Page too large" }, 413);
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; snapshot?: unknown; history?: PilotHistory };
  if (!(await ownTask(u.user_id, String(body.taskId || "")))) return extJson({ error: "Not found" }, 404);
  const snap = cleanSnapshot(body.snapshot);
  if (!snap) return extJson({ error: "No page" }, 400);
  const b = await loadBundle(String(body.taskId));
  if (!b) return extJson({ error: "Not found" }, 404);
  const ctx = pilotCtx(b, "extension");
  // LinkedIn doesn't allow automated clicking: fill each Easy Apply step, the person presses Next/Submit.
  try { ctx.assist = /(^|\.)linkedin\.com$/i.test(new URL(snap.url).hostname); } catch { /* keep default */ }
  const turn = await pilotStep(snap, Array.isArray(body.history) ? body.history.slice(-4) : [], ctx);
  return extJson(turn);
}
