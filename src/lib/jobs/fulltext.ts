import "server-only";
import { fetchBoard, fetchDescription, getJson, type Ats, type Board } from "./sources";
import { stripHtml } from "./signals";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import type { Job } from "@/lib/types";

/**
 * Vantage stores a short requirements summary for each job and fetches the full text live from the
 * employer only when someone needs it (opening a job, tailoring a resume). Fetched text is kept 30 days.
 */
const PREFIX_ATS: Record<string, Ats> = {
  gh: "greenhouse", lever: "lever", ashby: "ashby", wd: "workday", wk: "workable", rc: "recruitee",
};

export function isSummary(job: Pick<Job, "description"> & { desc_len?: number | null }): boolean {
  if (!job.description) return true;
  // Without the stored length, a long-ish description may be the ~2,000-character summary.
  if (job.desc_len == null) return job.description.length >= 1200;
  return job.desc_len > job.description.length + 20;
}

export async function fullDescription(job: Job & { desc_len?: number | null }): Promise<string | null> {
  if (!isSummary(job)) return job.description;
  const supa = supabaseAnon();
  const cached = await supa.rpc("job_text", { secret: ingestSecret(), op: "get", p_id: job.id }).then((r) => (r.data as string | null) || null, () => null);
  if (cached) return cached;

  const [prefix, token, ...rest] = job.id.split(":");
  const ext = rest.join(":");
  let text: string | null = null;
  try {
    if (prefix === "gh") {
      const d = await getJson<{ content?: string }>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${ext}`, {}, 15000);
      if (d?.content) text = stripHtml(stripHtml(d.content.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
    } else if (prefix === "lever") {
      type L = { descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string };
      const d = (await getJson<L>(`https://api.lever.co/v0/postings/${token}/${ext}?mode=json`, {}, 15000)) ||
        (await getJson<L>(`https://api.eu.lever.co/v0/postings/${token}/${ext}?mode=json`, {}, 15000));
      if (d) text = [d.descriptionPlain, ...(d.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`), d.additionalPlain].filter(Boolean).join("\n");
    } else if (prefix === "wd") {
      const u = new URL(job.url);
      const parts = u.pathname.split("/").filter(Boolean);
      const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || "") ? parts[1] : parts[0];
      if (site) text = await fetchDescription(job, { ats: "workday", token, host: u.host, site, name: job.company } as Board);
    } else if (PREFIX_ATS[prefix]) {
      const jobs = await fetchBoard({ ats: PREFIX_ATS[prefix], token, name: job.company } as Board);
      text = jobs?.find((j) => j.id === job.id)?.description || null;
    }
  } catch {
    text = null;
  }
  if (!text || text.length < 80) return job.description;
  await supa.rpc("job_text", { secret: ingestSecret(), op: "put", p_id: job.id, p_body: text }).then(() => {}, () => {});
  return text;
}
