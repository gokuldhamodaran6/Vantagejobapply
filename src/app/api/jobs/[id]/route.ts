import { fetchDescription, type Board } from "@/lib/jobs/sources";
import { storeJobs } from "@/lib/jobs/engine";
import { analyzeText } from "@/lib/jobs/signals";
import { matchJob } from "@/lib/jobs/match";
import { json, loadUserContext } from "@/lib/server-user";
import type { Job } from "@/lib/types";

/** Full job detail, enriching the description from the employer feed when missing. */
export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = await ctx2.params;
  const jobId = decodeURIComponent(id);
  const { data } = await ctx.supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (!data) return json({ error: "This job is no longer listed by the employer." }, 404);
  let job = data as Job;

  if (!job.description && (job.source === "workday" || job.source === "smartrecruiters")) {
    const token = job.id.split(":")[1];
    const { data: boards } = await ctx.supabase.from("boards").select("*").eq("token", token).limit(1);
    const b = boards?.[0] as Board | undefined;
    if (b) {
      const d = await fetchDescription(job, b);
      if (d) {
        const s = analyzeText(job.title, d);
        job = { ...job, description: d, sponsorship: s.sponsorship, restrictions: s.restrictions };
        storeJobs([job]).catch(() => {});
      }
    }
  }
  const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth });
  return json({ job, match });
}
