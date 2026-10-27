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
  // Version 1.0 filled only the page it was on. Ask for the update (it fills every page and can submit).
  const ver = req.headers.get("x-vantage-ext") || "1.0.0";
  // 1.1.0 could mark a job "Applied" from a sign-in or next-step page; 1.1.1 only does after a real Submit.
  if (ver.localeCompare("1.1.1", undefined, { numeric: true }) < 0) {
    return extJson({ error: "Please update the Vantage extension: open vantagejobapply.onrender.com → Chrome extension → Download version 1.1.1, unzip it over the old folder, then press reload on Vantage in chrome://extensions. This version only records a job as applied after Submit is really pressed." }, 426);
  }
  const b = (await req.json().catch(() => ({}))) as { url?: string; title?: string; company?: string; description?: string; location?: string; force?: boolean };
  const url = String(b.url || "").slice(0, 2000);
  if (!/^https:\/\//i.test(url) || !(await isSafePublicUrl(url))) return extJson({ error: "Open the job's application page first." }, 400);

  // A sign-in or redirect page isn't a job: never create an application called "Sign in - Google Accounts".
  const host = new URL(url).hostname.toLowerCase();
  const GENERIC = /^(sign in|log ?in|sign up|create (an )?account|recruitment|careers?( site| home)?|jobs?|job (search|application)|apply|home|federation redirector|candidate (home|experience)|welcome|my applications?|linkedin|indeed|search for jobs)\b|candidate experience site|\b(careers?|jobs)( site| page| portal)?$|^[^a-z]*$/i;
  if (/(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com)$/.test(host) || /\/(login|signin|sso|saml|oauth)\b/i.test(new URL(url).pathname)) {
    return extJson({ error: "This is a sign-in page. Sign in first, then press Apply with Vantage on the job's application page." }, 400);
  }
  let job: Job | null = (await jobFromLink(url).catch(() => null))?.job || null;
  if (!job) {
    // Page titles carry noise: "Apply to X - page 1", "X at Acme — Austin, TX | LinkedIn Jobs".
    let rawTitle = String(b.title || "").replace(/\s+/g, " ").trim();
    let rawCompany = String(b.company || "").trim();
    const li = rawTitle.match(/^(.+?) at (.+?)(?: [—–-] .*)?\s*\|\s*LinkedIn.*$/i);
    if (li) { rawTitle = li[1]; rawCompany ||= li[2]; }
    rawTitle = rawTitle.replace(/^apply (to|for)\s+/i, "").replace(/\s*[-–|]\s*page \d+( of \d+)?$/i, "").replace(/\s*[|–]\s*(linkedin|indeed).*$/i, "").trim();
    const title = rawTitle.slice(0, 200);
    if (!title || GENERIC.test(title)) return extJson({ error: "Couldn't read the job title on this page. Open the job description (or the first page of the application), then press Apply with Vantage." }, 400);
    // Shared careers platforms host many employers: their host name is never the company (silkroad, adp, linkedin…).
    const SHARED = /(^|\.)(silkroad\.com|adp\.com|linkedin\.com|myworkdayjobs\.com|icims\.com|taleo\.net|oraclecloud\.com|successfactors\.(com|eu)|ultipro\.com|paylocity\.com|paycomonline\.net|jobvite\.com|smartrecruiters\.com|applytojob\.com|brassring\.com)$/i;
    const pathCo = host.endsWith("silkroad.com") ? new URL(url).pathname.split("/").filter(Boolean)[0] || "" : "";
    const fromHost = SHARED.test(host) ? pathCo.replace(/([a-z])([A-Z])/g, "$1 $2") : new URL(url).hostname.replace(/^(www|careers|jobs|apply)\./, "").split(".")[0];
    const company = cleanCompany(rawCompany || fromHost);
    if (!company) return extJson({ error: "Couldn't tell which company this job is at. Open the job description page first, then press Apply with Vantage." }, 400);
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
