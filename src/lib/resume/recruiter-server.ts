import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resumePdf } from "@/lib/resume/pdf";
import { fileToText } from "@/lib/resume/extract";
import { parseResumeText } from "@/lib/resume/parse";
import { searchVariants } from "@/lib/jobs/roles";
import { titleTsQuery } from "@/lib/jobs/engine";
import { workAuthAnswers } from "@/lib/answers";
import { parseReadout, skillDemand, type Knockout, type ParseRow, type SkillDemand } from "@/lib/resume/recruiter";
import type { ResumeContent, ResumeStyle, TargetPrefs, WorkAuth } from "@/lib/types";

/** Render the resume exactly as it is downloaded, read the text back the way an ATS does, and compare. */
export async function atsReadout(c: ResumeContent, style: ResumeStyle = "classic", country = "US"): Promise<ParseRow[]> {
  const pdf = await resumePdf(c, { style, country });
  const text = await fileToText("resume.pdf", "application/pdf", pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer);
  return parseReadout(c, parseResumeText(text, c.name || ""));
}

/** Cached per user for a day: the role's skill demand across open postings. */
const memo = new Map<string, { at: number; v: unknown }>();
async function cached<T>(supabase: SupabaseClient, userId: string, key: string, maxAgeH: number, make: () => Promise<T>): Promise<T> {
  // Market demand is the same for everyone: a process-wide memo makes repeat visits instant.
  const hit = key.startsWith("demand") ? memo.get(key) : undefined;
  if (hit && Date.now() - hit.at < maxAgeH * 3600e3) return hit.v as T;
  try {
    const { data } = await supabase.from("resume_insights").select("data,updated_at").eq("user_id", userId).eq("key", key).maybeSingle();
    if (data && Date.now() - Date.parse(data.updated_at) < maxAgeH * 3600e3) return data.data as T;
  } catch {
    /* table not there yet: compute */
  }
  const v = await make();
  if (key.startsWith("demand")) memo.set(key, { at: Date.now(), v });
  try {
    await supabase.from("resume_insights").upsert({ user_id: userId, key, data: v as unknown as object, updated_at: new Date().toISOString() });
  } catch {
    /* ignore */
  }
  return v;
}

export type RoleDemand = { postings: number; skills: SkillDemand[]; industries?: SkillDemand[] };

export async function roleDemand(supabase: SupabaseClient, userId: string, title: string, country = "US"): Promise<RoleDemand> {
  return cached(supabase, userId, `demand3:${country}:${title.toLowerCase().trim()}`, 24, async () => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    // The exact title (plus one close variant) keeps the search on the index and under the statement timeout;
    // broad variant lists made big families like "Product Manager" time out and come back empty.
    const run = (phrases: string[]) => supabase.rpc("search_jobs", { p_country: country, p_tsquery: titleTsQuery(phrases), p_since: since, p_limit: 200 });
    let { data, error } = await run(searchVariants(title, 2));
    if (error) ({ data, error } = await run([title]));
    if (error) console.error("role demand search failed", title, error.message);
    const rows = ((data as { title: string; description: string | null }[]) || []).filter((j) => (j.description || "").length > 400);
    const texts = rows.map((j) => j.description || "");
    return { postings: rows.length, skills: skillDemand(texts, 12), industries: skillDemand(texts, 4, "industry") };
  });
}

/** One posting's skills (for checking against a specific job). */
export function jobDemand(description: string): RoleDemand {
  return { postings: 1, skills: skillDemand([description], 14).map((s) => ({ ...s, share: 100 })), industries: skillDemand([description], 4, "industry") };
}

/** The questions that remove candidates before a resume is read, answered from the person's own settings. */
export function knockouts(country: string, auth: WorkAuth[], prefs: TargetPrefs | null, location?: string): Knockout[] {
  const a = auth.find((x) => x.country === country);
  const out: Knockout[] = workAuthAnswers(country, a).slice(0, 2).map((x) => ({ q: x.q, a: a ? x.a : "Not set: add your work authorization in Settings", set: !!a }));
  const loc = prefs?.locations?.filter((l) => l.country === country).map((l) => [l.city, l.state].filter(Boolean).join(", "));
  out.push({ q: "Where can you work?", a: [location ? `Based in ${location}` : "", loc?.length ? `open to ${loc.join(", ")}` : "", prefs?.remote_ok || prefs?.work_modes?.includes("remote") ? "remote OK" : ""].filter(Boolean).join(" · ") || "Not set: add your locations in My targets", set: !!(location || loc?.length) });
  out.push({ q: "Desired salary", a: prefs?.salary_min ? `From ${prefs.currency || ""} ${prefs.salary_min.toLocaleString("en-US")}`.trim() : "Not set: add a minimum in My targets so Vantage answers consistently", set: !!prefs?.salary_min });
  return out;
}
