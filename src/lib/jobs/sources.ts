import "server-only";
import { analyzeText, stripHtml } from "./signals";
import { detectCountry, isRemoteLocation } from "./geo";
import type { Job } from "@/lib/types";

// Every job comes from the employer's own careers system (ATS), and every
// link points to the employer's official posting — never to an aggregator.

export type Ats = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "recruitee" | "workday";
export type Board = {
  id?: number;
  ats: Ats;
  token: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  host?: string | null; // workday
  site?: string | null; // workday
};

const UA = "Mozilla/5.0 (compatible; VantageJobs/1.0; +https://vantage.jobs/bot)";

async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US", ...(init.headers || {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", IN: "INR", SG: "SGD", DE: "EUR", NL: "EUR", FR: "EUR",
  ES: "EUR", IT: "EUR", IE: "EUR", CH: "CHF", PL: "PLN",
};
export const currencyFor = (c: string) => CURRENCY[c] || "USD";

const NAME_TO_CODE: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", "united kingdom": "GB", uk: "GB", gb: "GB", canada: "CA", australia: "AU",
  germany: "DE", ireland: "IE", india: "IN", singapore: "SG", netherlands: "NL", france: "FR", spain: "ES", "new zealand": "NZ",
};
function countryCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s.length === 2) return s.toUpperCase() === "UK" ? "GB" : s.toUpperCase();
  return NAME_TO_CODE[s] || null;
}

function finalize(b: Board, base: Omit<Job, "sponsorship" | "restrictions" | "remote" | "sponsor_registered" | "company" | "category" | "currency"> & { remote?: boolean; currency?: string | null }): Job {
  const s = analyzeText(base.title, base.description);
  return {
    ...base,
    company: b.name,
    category: b.industry || null,
    currency: base.currency ?? null,
    remote: Boolean(base.remote) || s.remote || isRemoteLocation(base.location),
    sponsorship: s.sponsorship,
    restrictions: s.restrictions,
    sponsor_registered: false,
  };
}

const fallbackCountry = (b: Board) => b.country || "US";

/* ------------------------------ Greenhouse ------------------------------ */
type GhJob = { id: number; title: string; absolute_url: string; location?: { name?: string }; updated_at?: string; first_published?: string; content?: string };
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function greenhouse(b: Board): Promise<Job[] | null> {
  const data = await getJson<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs?content=true`, {}, 20000);
  if (!data) return null;
  return data.jobs.map((j) => {
    const loc = j.location?.name || null;
    return finalize(b, {
      id: `gh:${b.token}:${j.id}`, source: "greenhouse", country: detectCountry(loc, fallbackCountry(b)) || "US", title: j.title, location: loc,
      description: stripHtml(decode(j.content || "")).slice(0, 15000), url: j.absolute_url, salary_min: null, salary_max: null,
      contract_time: null, posted_at: j.first_published || j.updated_at || null,
    });
  });
}

/* --------------------------------- Lever -------------------------------- */
type LeverJob = { id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number; country?: string; workplaceType?: string; categories?: { location?: string; commitment?: string }; descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[] };

async function lever(b: Board): Promise<Job[] | null> {
  const data = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${b.token}?mode=json`, {}, 20000);
  if (!Array.isArray(data)) return null;
  return data.map((j) => {
    const loc = j.categories?.location || null;
    const lists = (j.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n");
    return finalize(b, {
      id: `lever:${b.token}:${j.id}`, source: "lever", country: countryCode(j.country) || detectCountry(loc, fallbackCountry(b)) || "US",
      title: j.text, location: loc, remote: j.workplaceType === "remote",
      description: `${j.descriptionPlain || ""}\n${lists}\n${j.additionalPlain || ""}`.slice(0, 15000), url: j.hostedUrl,
      salary_min: null, salary_max: null, contract_time: j.categories?.commitment || null,
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    });
  });
}

/* --------------------------------- Ashby -------------------------------- */
type AshbyJob = { id: string; title: string; location?: string; isRemote?: boolean; workplaceType?: string; descriptionPlain?: string; jobUrl?: string; applyUrl?: string; publishedAt?: string; employmentType?: string; isListed?: boolean; address?: { postalAddress?: { addressCountry?: string } } };

async function ashby(b: Board): Promise<Job[] | null> {
  const data = await getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${b.token}?includeCompensation=false`, {}, 20000);
  if (!data) return null;
  return data.jobs.filter((j) => j.isListed !== false).map((j) => {
    const loc = j.location || null;
    return finalize(b, {
      id: `ashby:${b.token}:${j.id}`, source: "ashby",
      country: countryCode(j.address?.postalAddress?.addressCountry) || detectCountry(loc, fallbackCountry(b)) || "US",
      title: j.title, location: loc, remote: Boolean(j.isRemote) || j.workplaceType === "Remote",
      description: (j.descriptionPlain || "").slice(0, 15000), url: j.jobUrl || j.applyUrl || `https://jobs.ashbyhq.com/${b.token}`,
      salary_min: null, salary_max: null, contract_time: j.employmentType || null, posted_at: j.publishedAt || null,
    });
  });
}

/* ---------------------------- SmartRecruiters --------------------------- */
type SrItem = { id: string; name: string; releasedDate?: string; location?: { country?: string; city?: string; region?: string; remote?: boolean }; typeOfEmployment?: { label?: string }; company?: { name?: string } };

async function smartrecruiters(b: Board): Promise<Job[] | null> {
  const out: Job[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const data = await getJson<{ content: SrItem[]; totalFound: number }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.token)}/postings?limit=100&offset=${offset}`);
    if (!data) return offset === 0 ? null : out;
    for (const j of data.content) {
      const loc = [j.location?.city, j.location?.region, j.location?.country?.toUpperCase()].filter(Boolean).join(", ");
      out.push(finalize(b, {
        id: `sr:${b.token}:${j.id}`, source: "smartrecruiters", country: countryCode(j.location?.country) || detectCountry(loc, fallbackCountry(b)) || "US",
        title: j.name, location: loc || null, remote: Boolean(j.location?.remote), description: null,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.token)}/${j.id}`, salary_min: null, salary_max: null,
        contract_time: j.typeOfEmployment?.label || null, posted_at: j.releasedDate || null,
      }));
    }
    if (offset + 100 >= (data.totalFound || 0)) break;
  }
  return out;
}

/* -------------------------------- Workable ------------------------------- */
type WkJob = { id?: string; shortcode: string; title: string; url?: string; shortlink?: string; application_url?: string; published_on?: string; created_at?: string; employment_type?: string; telecommuting?: boolean; country?: string; city?: string; state?: string; description?: string; full_description?: string; location?: { country_code?: string; country?: string; city?: string; location_str?: string; telecommuting?: boolean } };

async function workable(b: Board): Promise<Job[] | null> {
  const data = await getJson<{ name?: string; jobs: WkJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${b.token}?details=true`, {}, 20000);
  if (!data?.jobs) return null;
  return data.jobs.map((j) => {
    const loc = j.location?.location_str || [j.city, j.state, j.country].filter(Boolean).join(", ") || null;
    return finalize(b, {
      id: `wk:${b.token}:${j.shortcode}`, source: "workable",
      country: countryCode(j.location?.country_code) || countryCode(j.country) || detectCountry(loc, fallbackCountry(b)) || "US",
      title: j.title, location: loc, remote: Boolean(j.telecommuting || j.location?.telecommuting),
      description: stripHtml(j.full_description || j.description || "").slice(0, 15000),
      url: j.url || j.shortlink || `https://apply.workable.com/${b.token}/j/${j.shortcode}/`, salary_min: null, salary_max: null,
      contract_time: j.employment_type || null, posted_at: j.published_on || j.created_at || null,
    });
  });
}

/* ------------------------------- Recruitee ------------------------------- */
type RcOffer = { id: number; slug: string; title: string; careers_url?: string; description?: string; requirements?: string; city?: string; country_code?: string; location?: string; remote?: boolean; published_at?: string; employment_type_code?: string; status?: string };

async function recruitee(b: Board): Promise<Job[] | null> {
  const data = await getJson<{ offers: RcOffer[] }>(`https://${b.token}.recruitee.com/api/offers/`, {}, 20000);
  if (!data?.offers) return null;
  return data.offers.filter((o) => !o.status || o.status === "published").map((o) =>
    finalize(b, {
      id: `rc:${b.token}:${o.id}`, source: "recruitee", country: countryCode(o.country_code) || detectCountry(o.location || o.city, fallbackCountry(b)) || "US",
      title: o.title, location: o.location || o.city || null, remote: Boolean(o.remote),
      description: stripHtml(`${o.description || ""}\n${o.requirements || ""}`).slice(0, 15000),
      url: o.careers_url || `https://${b.token}.recruitee.com/o/${o.slug}`, salary_min: null, salary_max: null,
      contract_time: o.employment_type_code || null, posted_at: o.published_at ? o.published_at.replace(" UTC", "Z").replace(" ", "T") : null,
    }),
  );
}

/* -------------------------------- Workday -------------------------------- */
type WdPosting = { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };

function postedOnToDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  const now = Date.now();
  if (t.includes("today")) return new Date(now).toISOString();
  if (t.includes("yesterday")) return new Date(now - 864e5).toISOString();
  const m = t.match(/(\d+)\+?\s*day/);
  if (m) return new Date(now - parseInt(m[1], 10) * 864e5).toISOString();
  return null;
}

async function workday(b: Board, maxPages = 10): Promise<Job[] | null> {
  if (!b.host || !b.site) return null;
  const base = `https://${b.host}/wday/cxs/${b.token}/${b.site}`;
  const out: Job[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await getJson<{ total: number; jobPostings: WdPosting[] }>(`${base}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText: "" }),
    });
    if (!data) return page === 0 ? null : out;
    for (const p of data.jobPostings) {
      const loc = p.locationsText || null;
      const reqId = p.bulletFields?.[0] || p.externalPath.split("_").pop() || p.externalPath;
      out.push(finalize(b, {
        id: `wd:${b.token}:${reqId}`, source: "workday", country: detectCountry(loc, fallbackCountry(b)) || "US", title: p.title,
        location: loc, description: null, url: `https://${b.host}/en-US/${b.site}${p.externalPath}`, salary_min: null, salary_max: null,
        contract_time: null, posted_at: postedOnToDate(p.postedOn),
      }));
    }
    if ((page + 1) * 20 >= (data.total || 0)) break;
  }
  return out;
}

export async function fetchBoard(b: Board): Promise<Job[] | null> {
  switch (b.ats) {
    case "greenhouse": return greenhouse(b);
    case "lever": return lever(b);
    case "ashby": return ashby(b);
    case "smartrecruiters": return smartrecruiters(b);
    case "workable": return workable(b);
    case "recruitee": return recruitee(b);
    case "workday": return workday(b);
  }
}

/** Fetch the full description for feeds whose list endpoint omits it. */
export async function fetchDescription(job: Pick<Job, "id" | "source" | "url">, b: Board): Promise<string | null> {
  if (job.source === "smartrecruiters") {
    const id = job.id.split(":").pop();
    const d = await getJson<{ jobAd?: { sections?: Record<string, { text?: string }> } }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.token)}/postings/${id}`);
    const s = d?.jobAd?.sections;
    if (!s) return null;
    return stripHtml(["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map((k) => s[k]?.text || "").join("\n")).slice(0, 15000);
  }
  if (job.source === "workday" && b.host && b.site) {
    const path = job.url.split(`/${b.site}`)[1];
    const d = await getJson<{ jobPostingInfo?: { jobDescription?: string } }>(`https://${b.host}/wday/cxs/${b.token}/${b.site}${path}`);
    return d?.jobPostingInfo?.jobDescription ? stripHtml(d.jobPostingInfo.jobDescription).slice(0, 15000) : null;
  }
  return null;
}

/* ----------------------- Recognise official job links ---------------------- */
export function boardFromUrl(raw: string): Omit<Board, "name"> | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (h.endsWith("greenhouse.io")) {
    const token = h.startsWith("boards-api") ? parts[2] : parts[0] === "embed" ? u.searchParams.get("for") : parts[0];
    return token ? { ats: "greenhouse", token } : null;
  }
  if (h === "jobs.lever.co" || h === "jobs.eu.lever.co") return parts[0] ? { ats: "lever", token: parts[0] } : null;
  if (h === "jobs.ashbyhq.com") return parts[0] ? { ats: "ashby", token: parts[0] } : null;
  if (h === "jobs.smartrecruiters.com" || h === "careers.smartrecruiters.com") return parts[0] ? { ats: "smartrecruiters", token: parts[0] } : null;
  if (h === "apply.workable.com") return parts[0] ? { ats: "workable", token: parts[0] } : null;
  if (h.endsWith(".recruitee.com")) return { ats: "recruitee", token: h.split(".")[0] };
  if (h.endsWith(".myworkdayjobs.com")) {
    const tenant = h.split(".")[0];
    const site = parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/) ? parts[1] : parts[0];
    return site ? { ats: "workday", token: tenant, host: h, site } : null;
  }
  return null;
}

/** Try to find which careers system a company uses, by name. */
export async function resolveCompany(name: string): Promise<Board | null> {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").trim();
  const words = base.split(/\s+/).filter((w) => !["inc", "ltd", "limited", "llc", "plc", "group", "the", "co", "corp"].includes(w));
  const slugs = [...new Set([words.join(""), words.join("-"), words[0], `${words.join("")}careers`, `${words.join("")}jobs`].filter((s) => s && s.length > 1))];
  const tries: Board[] = [];
  for (const s of slugs) {
    tries.push({ ats: "greenhouse", token: s, name }, { ats: "lever", token: s, name }, { ats: "ashby", token: s, name }, { ats: "workable", token: s, name }, { ats: "recruitee", token: s, name });
  }
  const pretty = name.replace(/[^A-Za-z0-9]/g, "");
  tries.push({ ats: "smartrecruiters", token: pretty, name });
  const results = await Promise.all(tries.map(async (b) => ({ b, jobs: await fetchBoard(b).catch(() => null) })));
  const hit = results.filter((r) => r.jobs && r.jobs.length > 0).sort((a, z) => (z.jobs!.length - a.jobs!.length))[0];
  return hit ? hit.b : null;
}
