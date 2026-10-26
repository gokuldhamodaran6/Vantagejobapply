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
  const b = await loadBundle(taskId);
  if (!b) return extJson({ error: "Not found" }, 404);
  const files = await filesFor(b);
  const f = sp.get("kind") === "cover_letter" ? files.cover : files.resume;
  if (!f) return extJson({ error: "No file" }, 404);
  return extJson(f);
}
