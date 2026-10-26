import { boardFromUrl, resolveCompany, type Board } from "@/lib/jobs/sources";
import { refreshBoard } from "@/lib/jobs/engine";
import { normCompany } from "@/lib/jobs/signals";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { json, loadUserContext } from "@/lib/server-user";

export const maxDuration = 60;

/**
 * Add a company to the watched list — by name (auto-detects its careers system)
 * or by pasting any job/careers link from that company.
 * Body: { name?: string, url?: string }
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { name, url } = (await req.json().catch(() => ({}))) as { name?: string; url?: string };

  // Already watched?
  if (name) {
    const { data: existing } = await ctx.supabase.from("boards").select("*").eq("name_norm", normCompany(name)).eq("active", true).limit(1);
    if (existing?.length) return json({ ok: true, board: existing[0], already: true });
  }

  let board: Board | null = null;
  if (url) {
    const b = boardFromUrl(url);
    if (!b) return json({ error: "That link isn't from a careers system we can read yet (Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Workable or Recruitee). Try the company's own careers page link." }, 400);
    board = { ...b, name: name?.trim() || b.token.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
  } else if (name && name.trim().length > 1) {
    board = await resolveCompany(name.trim());
    if (!board) return json({ found: false, error: `We couldn't find ${name}'s careers feed automatically. Paste any job link from their careers site and we'll add it.` }, 404);
  } else return json({ error: "Enter a company name or paste a job link." }, 400);

  const supa = supabaseAnon();
  const { data: id, error } = await supa.rpc("upsert_board", {
    secret: ingestSecret(),
    p: { ats: board.ats, token: board.token, name: board.name, host: board.host || null, site: board.site || "", added_by: ctx.user.id },
  });
  if (error) return json({ error: error.message }, 500);
  const count = await refreshBoard({ ...board, id: id as number, site: board.site || "" });
  return json({ ok: true, board: { ...board, id }, jobs: count });
}
