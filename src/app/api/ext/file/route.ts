import { extJson, extUser, ownTask } from "@/lib/ext";
import { filesFor, loadBundle } from "@/lib/agent/bundle";

export const maxDuration = 60;

/** The tailored resume or cover letter PDF for this job, for the extension to attach to the upload field. */
export async function GET(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const sp = new URL(req.url).searchParams;
  const taskId = sp.get("taskId") || "";
  if (!(await ownTask(u.user_id, taskId))) return extJson({ error: "Not found" }, 404);
  let b = await loadBundle(taskId);
  if (!b) return extJson({ error: "Not found" }, 404);
  // The resume and letter for this job may still be being written. Never hold the request long (Chrome stops an
  // extension that waits ~30 s on one request): wait a few seconds at most, then say "not yet" and the extension
  // carries on with the rest of the form and asks again. "now=1" takes the person's own resume instead.
  if (!b.task.cover_letter && sp.get("now") !== "1") {
    for (let k = 0; k < 3 && !b.task.cover_letter; k++) {
      await new Promise((r) => setTimeout(r, 2000));
      b = (await loadBundle(taskId)) || b;
    }
    if (!b.task.cover_letter) return extJson({ pending: true }, 202);
  }
  const files = await filesFor(b);
  const f = sp.get("kind") === "cover_letter" ? files.cover : files.resume;
  if (!f) return extJson({ error: "No file" }, 404);
  return extJson(f);
}
