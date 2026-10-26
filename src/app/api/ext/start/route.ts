import { createHash } from "crypto";
import { after } from "next/server";
import { extJson, extRpc, extUser } from "@/lib/ext";
import { jobFromLink, cleanCompany } from "@/lib/agent/jobs";
import { prepareAndQueue } from "@/lib/agent/prepare";
import { matchJob } from "@/lib/jobs/match";
import { ghostRisk } from "@/lib/jobs/ghost";
import { isSafePublicUrl } from "@/lib/net";
import type { Job } from "@/lib/types";

export const maxDuration = 120;

/**
 * The user pressed "Fill with Vantage" on a job page. Work out the job, then write the tailored resume and
 * cover letter for it (or reuse the ones already written) and open a task the extension fills from.
 * Nothing is submitted by Vantage: the user reviews and presses Submit on the company's site.
 */
export async function POST(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  const b = (await req.json().catch(() => ({}))) as { url?: string; title?: string; company?: string; description?: string; location?: string; force?: boolean };
  const url = String(b.url || "").slice(0, 2000);
  if (!/^https:\/\//i.test(url) || !(await isSafePublicUrl(url))) return extJson({ error: "Open the job's application page first." }, 400);

  let job: Job | null = (await jobFromLink(url).catch(() => null))?.job || null;
  if (!job) {
    const title = String(b.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const company = cleanCompany(String(b.company || "").trim() || new URL(url).hostname.replace(/^(www|careers|jobs|apply)\./, "").split(".")[0]);
    if (!title) return extJson({ error: "Couldn't read the job title on this page." }, 400);
    const clean = url.split("#")[0].replace(/[?&](utm_[^=]+|gh_src|source|ref)=[^&]*/gi, "");
    job = {
      id: `page:${createHash("sha1").update(clean).digest("hex").slice(0, 20)}`,
      source: "page", country: u.prefs?.countries?.[0] || "US", title, company: company.replace(/\b\w/g, (c) => c.toUpperCase()),
      location: b.location || null, remote: /remote/i.test(`${b.location || ""} ${title}`), description: String(b.description || "").slice(0, 20000),
      url, salary_min: null, salary_max: null, currency: null, category: null, contract_time: null, posted_at: null,
      sponsorship: null, sponsor_registered: null, restrictions: [],
    } as unknown as Job;
  }

  const ghost = ghostRisk(job);
  const already = await extRpc<boolean>("already_applied", { user_id: u.user_id, job_id: job.id, company: job.company, title: job.title });
  if (already && !b.force) return extJson({ alreadyApplied: true, job: { title: job.title, company: job.company }, ghost });

  const existing = await extRpc<{ id: string; status: string } | null>("find_task", { user_id: u.user_id, job_id: job.id });
  if (existing && existing.status !== "cancelled") return extJson({ taskId: existing.id, job: { title: job.title, company: job.company }, ghost, reused: true });

  const match = matchJob(job, { roles: u.roles, prefs: u.prefs, auth: u.auth });
  // Filling starts right away; the resume and cover letter for this job are written meanwhile (~30 s) and attached
  // when the form reaches the upload.
  const r = await prepareAndQueue({ userId: u.user_id, name: u.profile?.full_name || "", job, roleId: match.role?.id || null, match: match.score, status: "extension", priority: 9, deferTailoring: true });
  if (r.error) return extJson({ error: r.error }, 400);
  const t = await extRpc<{ id: string } | null>("find_task", { user_id: u.user_id, job_id: job.id });
  if (!t) return extJson({ error: "Couldn't start this application." }, 500);
  if (r.tailor) {
    const tailor = r.tailor;
    after(() => tailor(t.id).catch((e) => console.error("extension tailoring failed", e)));
  }
  return extJson({ taskId: t.id, job: { title: job.title, company: job.company }, ghost, match: match.score, role: match.role?.title || null, tailoring: Boolean(r.tailor) });
}
