import { json, loadUserContext } from "@/lib/server-user";
import { jobFromLink } from "@/lib/agent/jobs";
import { matchJob } from "@/lib/jobs/match";
import { money } from "@/lib/format";

export const maxDuration = 60;

/** Careers systems that make you create an account before applying (the agent does that with your job email). */
const ACCOUNT_ATS = /workday|icims|taleo|successfactors|oracle|avature|brassring|phenom|eightfold/i;
const ATS_NAME: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", workable: "Workable", recruitee: "Recruitee", icims: "iCIMS" };

/**
 * Paste a job link: read it and show what it is before anything happens — title, pay, how well it fits,
 * whether you've applied before and whether the site needs an account. Nothing is queued here.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { link } = (await req.json().catch(() => ({}))) as { link?: string };
  if (!link || !/^https?:\/\//i.test(link.trim())) return json({ error: "Paste the full job link, starting with https://" }, 400);
  const found = await jobFromLink(link).catch(() => null);
  if (!found) return json({ error: "We couldn't read that job link. Check it opens the job on the company's site and try again." }, 400);
  const job = found.job;
  const m = matchJob(job, { roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth });
  const { data: blocked } = await ctx.supabase.rpc("apply_check", { p_job_id: job.id, p_company: job.company, p_title: job.title });
  const ats = String(found.board?.ats || (job as { ats?: string }).ats || "").toLowerCase();
  let host = "";
  try { host = new URL(job.url || link).hostname.replace(/^www\./, ""); } catch {}
  return json({
    job: { id: job.id, title: job.title, company: job.company, location: job.location || null, remote: Boolean(job.remote), posted_at: job.posted_at || null, url: job.url || link, pay: money(job.salary_min, job.salary_max, job.currency) || null },
    match: { score: m.score, eligible: m.eligible, blockers: m.blockers.slice(0, 3), warnings: m.warnings.slice(0, 3), reasons: m.reasons.slice(0, 3), role: m.role ? { id: m.role.id, title: m.role.title } : null },
    site: { system: ATS_NAME[ats] || (host ? host : "Company site"), host, account: ACCOUNT_ATS.test(`${ats} ${host}`) },
    duplicate: blocked || null,
    closed: Boolean((job as { closed_at?: string | null }).closed_at),
  });
}
