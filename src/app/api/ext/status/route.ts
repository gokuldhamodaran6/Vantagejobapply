import { extJson, extUser } from "@/lib/ext";
import { loadReport } from "@/lib/agent/report";

/**
 * Is the resume and cover letter for this job written yet, and what does it cover? The extension asks every few
 * seconds while it fills the rest of the form (each answer is quick, so Chrome never stops the extension mid-wait).
 */
export async function GET(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const taskId = new URL(req.url).searchParams.get("taskId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return extJson({ error: "Not found" }, 404);
  const r = await loadReport(taskId).catch(() => null);
  if (!r || r.user_id !== u.user_id) return extJson({ error: "Not found" }, 404);
  return extJson({ ready: r.ready, report: r.report, resumeId: r.resume_id });
}
