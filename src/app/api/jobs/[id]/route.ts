import { fullDescription, isSummary } from "@/lib/jobs/fulltext";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
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

  // Vantage keeps a short summary; the full posting is read live from the employer (and cached 30 days).
  if (isSummary(job as Job & { desc_len?: number | null })) {
    const d = await fullDescription(job as Job & { desc_len?: number | null });
    if (d && d !== job.description) {
      const s = analyzeText(job.title, d);
      if (!job.description) {
        void supabaseAnon().rpc("set_job_description", { secret: ingestSecret(), p_id: job.id, p_description: d }).then(() => {}, () => {});
      }
      job = { ...job, description: d, sponsorship: job.description ? job.sponsorship : s.sponsorship, restrictions: job.description ? job.restrictions : s.restrictions };
    }
  }
  const match = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth });
  return json({ job, match });
}
