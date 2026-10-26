import "server-only";
import { boardFromUrl, fetchBoard, fetchDescription, type Board } from "@/lib/jobs/sources";
import { analyzeText, stripHtml } from "@/lib/jobs/signals";
import { detectCountry } from "@/lib/jobs/geo";
import type { Job } from "@/lib/types";

export type ApplyTarget = { ats: string; url: string; host: string };

/** Where the agent should go to apply, per careers system. */
export function applyTarget(job: Pick<Job, "id" | "source" | "url">): ApplyTarget {
  const [, token, id] = job.id.split(":");
  const host = (() => {
    try {
      return new URL(job.url).hostname;
    } catch {
      return "";
    }
  })();
  switch (job.source) {
    case "greenhouse":
      return { ats: "greenhouse", url: `https://job-boards.greenhouse.io/${token}/jobs/${id}`, host: "greenhouse.io" };
    case "lever":
      return { ats: "lever", url: `https://jobs.lever.co/${token}/${id}/apply`, host: "lever.co" };
    case "ashby":
      return { ats: "ashby", url: `https://jobs.ashbyhq.com/${token}/${id}/application`, host: "ashbyhq.com" };
    case "workday":
      return { ats: "workday", url: job.url, host };
    case "smartrecruiters":
      return { ats: "smartrecruiters", url: job.url, host: "smartrecruiters.com" };
    case "workable":
      return { ats: "workable", url: job.url.replace(/\/?$/, "/apply/"), host: "workable.com" };
    default:
      return { ats: "generic", url: job.url, host };
  }
}

/** Vault key for a site: Workday logins are per company tenant; most others don't need an account. */
export function vaultHost(t: ApplyTarget): string {
  return t.ats === "workday" ? t.host : t.host.replace(/^www\./, "");
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Turn any job link into a full job record, read from the official source. */
export async function jobFromLink(raw: string): Promise<{ job: Job; board: (Omit<Board, "name"> & { name: string }) | null } | null> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const b = boardFromUrl(u.toString());
  if (b) {
    const name = b.token.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const board = { ...b, name } as Board;
    const jobs = (await fetchBoard(board).catch(() => null)) || [];
    const parts = u.pathname.split("/").filter(Boolean);
    const want = (() => {
      if (b.ats === "greenhouse") return u.searchParams.get("gh_jid") || parts[parts.indexOf("jobs") + 1];
      if (b.ats === "lever" || b.ats === "ashby") return parts[1];
      if (b.ats === "smartrecruiters") return parts[1]?.split("-")[0];
      if (b.ats === "workable") return parts[parts.indexOf("j") + 1];
      if (b.ats === "recruitee") return parts[parts.indexOf("o") + 1];
      if (b.ats === "workday") return u.pathname.match(/_([A-Z]*-?\d[\w-]*)$/)?.[1] || u.pathname.split("/").pop();
      return null;
    })();
    const hit = jobs.find((j) => {
      const id = j.id.split(":").pop() || "";
      return (want && (id === want || id.endsWith(want) || j.url.includes(want))) || j.url.replace(/\/$/, "") === u.toString().replace(/\/$/, "");
    });
    if (hit) {
      if (!hit.description) hit.description = await fetchDescription(hit, board).catch(() => null);
      const real = jobs[0]?.company && jobs[0].company !== name ? jobs[0].company : name;
      return { job: { ...hit, company: real }, board: { ...b, name: real } };
    }
  }
  // Any other careers site: read the schema.org JobPosting most company sites publish for search engines.
  const page = await fetch(u.toString(), { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!page?.ok) return null;
  const html = await page.text();
  const posting = findJobPosting(html);
  const title = posting?.title || html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] || html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (!title) return null;
  const company = posting?.hiringOrganization?.name || html.match(/<meta property="og:site_name" content="([^"]+)"/i)?.[1] || u.hostname.replace(/^www\.|^careers\.|^jobs\./, "").split(".")[0];
  const loc = (() => {
    const jl = Array.isArray(posting?.jobLocation) ? posting.jobLocation[0] : posting?.jobLocation;
    const a = jl?.address;
    return a ? [a.addressLocality, a.addressRegion, typeof a.addressCountry === "string" ? a.addressCountry : a.addressCountry?.name].filter(Boolean).join(", ") : null;
  })();
  const description = stripHtml(posting?.description || html.match(/<meta (?:name|property)="(?:og:)?description" content="([^"]+)"/i)?.[1] || "").slice(0, 15000);
  const s = analyzeText(title, description);
  const job: Job = {
    id: `link:${u.hostname}:${Buffer.from(u.pathname + u.search).toString("base64url").slice(0, 60)}`,
    source: "company_site",
    country: detectCountry(loc || "", "US") || "US",
    title: decodeEntities(title).trim(),
    company: decodeEntities(String(company)).trim(),
    location: loc,
    remote: s.remote || posting?.jobLocationType === "TELECOMMUTE",
    description,
    url: u.toString(),
    salary_min: null,
    salary_max: null,
    currency: null,
    category: null,
    contract_time: null,
    posted_at: posting?.datePosted ? new Date(posting.datePosted).toISOString() : new Date().toISOString(),
    sponsorship: s.sponsorship,
    sponsor_registered: false,
    restrictions: s.restrictions,
  };
  return { job, board: null };
}

type Posting = {
  title?: string;
  description?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } } | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } }[];
  jobLocationType?: string;
};

function findJobPosting(html: string): Posting | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const list = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      const p = list.find((x: { "@type"?: string | string[] }) => [x?.["@type"]].flat().includes("JobPosting"));
      if (p) return p as Posting;
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+[|–-]\s+.*careers.*$/i, "");
}
