import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractKeywords } from "@/lib/ats";
import { searchVariants } from "@/lib/jobs/roles";
import { titleTsQuery } from "@/lib/jobs/engine";

/** The skills live postings for a role ask for most often (what an ATS will look for). */
export async function marketKeywords(supabase: SupabaseClient, roleTitle: string, country = "US", max = 24): Promise<string[]> {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await supabase.rpc("search_jobs", { p_country: country, p_tsquery: titleTsQuery(searchVariants(roleTitle, 6)), p_since: since, p_limit: 60 });
  const text = ((data as { title: string; description: string | null }[]) || []).map((j) => `${j.title} ${j.description || ""}`).join("\n");
  return extractKeywords(`${roleTitle} ${text}`, max);
}
