import { extJson, extUser, ownTask } from "@/lib/ext";
import { filesFor, loadBundle } from "@/lib/agent/bundle";

export const maxDuration = 90;

/** The tailored resume or cover letter PDF for this job, for the extension to attach to the upload field. */
export async function GET(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const sp = new URL(req.url).searchParams;
  const taskId = sp.get("taskId") || "";
  if (!(await ownTask(u.user_id, taskId))) return extJson({ error: "Not found" }, 404);
  let b = await loadBundle(taskId);
  if (!b) return extJson({ error: "Not found" }, 404);
  // The tailored resume may still be being written (filling started at once): wait for it up to ~45 s, then use the
  // person's own resume rather than hold the form up. "now=1" skips the wait.
  // Résumé: wait up to ~30 s; cover letter: ~16 s (it's optional on most forms), then carry on without it.
  if (!b.task.cover_letter && sp.get("now") !== "1") {
    const rounds = sp.get("kind") === "cover_letter" ? 8 : 15;
    for (let k = 0; k < rounds && !b.task.cover_letter; k++) {
      await new Promise((r) => setTimeout(r, 2000));
      b = (await loadBundle(taskId)) || b;
    }
  }
  const files = await filesFor(b);
  const f = sp.get("kind") === "cover_letter" ? files.cover : files.resume;
  if (!f) return extJson({ error: "No file" }, 404);
  return extJson(f);
}
