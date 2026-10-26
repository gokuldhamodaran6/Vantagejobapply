import { json, loadUserContext } from "@/lib/server-user";
import { parseCsv } from "@/lib/csv";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Admin: load USCIS's H-1B Employer Data Hub export (CSV) so US jobs are flagged
 * "Has sponsored H-1B visas before" from official data. Download it at uscis.gov → H-1B Employer Data Hub → Export.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx || ctx.profile.role !== "admin") return json({ error: "Admins only." }, 403);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Choose the CSV file." }, 400);
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return json({ error: "That file looks empty." }, 400);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => /employer|petitioner/.test(h) && /name|employer/.test(h));
  const cityIdx = header.findIndex((h) => /city/.test(h));
  const approvalIdx = header.map((h, i) => (/approv/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (nameIdx < 0) return json({ error: "Couldn't find the employer name column. Upload the H-1B Employer Data Hub export." }, 400);
  const byName = new Map<string, { name: string; city: string | null }>();
  for (const r of rows.slice(1)) {
    const name = (r[nameIdx] || "").trim();
    if (!name) continue;
    const approvals = approvalIdx.reduce((n, i) => n + (parseInt((r[i] || "0").replace(/,/g, ""), 10) || 0), 0);
    if (approvalIdx.length && approvals === 0) continue;
    byName.set(name.toLowerCase(), { name, city: cityIdx >= 0 ? r[cityIdx] || null : null });
  }
  const all = [...byName.values()].map((v) => ({ name: v.name, city: v.city, route: "H-1B" }));
  const supa = supabaseAnon();
  let stored = 0;
  for (let i = 0; i < all.length; i += 2000) {
    const { data, error } = await supa.rpc("ingest_sponsors", { secret: ingestSecret(), p_country: "US", p_source: "uscis_h1b", rows: all.slice(i, i + 2000) });
    if (error) return json({ error: error.message, stored }, 500);
    stored += (data as number) || 0;
  }
  await supa.rpc("refresh_sponsor_flags", { secret: ingestSecret() });
  return json({ ok: true, employers: all.length, stored });
}
