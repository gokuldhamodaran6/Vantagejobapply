import { json, loadUserContext } from "@/lib/server-user";

export const maxDuration = 300;

/** Lets the admin trigger ingestion tasks from the portal. */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx || ctx.profile.role !== "admin") return json({ error: "forbidden" }, 403);
  const { task } = (await req.json().catch(() => ({}))) as { task?: string };
  if (!["boards", "enrich", "uk_sponsors", "prune", "discover", "agent", "all"].includes(task || "")) return json({ error: "unknown task" }, 400);
  const origin = new URL(req.url).origin;
  const r = await fetch(`${origin}/api/cron/ingest?task=${task}`, { method: "POST", headers: { "x-cron-secret": process.env.INGEST_SECRET || "" } });
  return json(await r.json(), r.status);
}
