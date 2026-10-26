import { json, loadUserContext } from "@/lib/server-user";
import { decryptFor } from "@/lib/vault";

/** Reveal one of your saved career-site passwords (only to you, only on request, and the request is logged). */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const { data } = await ctx.supabase.from("vault_credentials").select("id,host,login,secret_enc").eq("id", id || "").maybeSingle();
  if (!data) return json({ error: "Not found" }, 404);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await ctx.supabase.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("type", "vault_reveal").gte("created_at", since);
  if ((count || 0) > 40) return json({ error: "Too many reveals in the last hour. Try again later." }, 429);
  await ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "vault_reveal", meta: { host: data.host } });
  try {
    return json({ login: data.login, password: decryptFor(ctx.user.id, data.secret_enc) });
  } catch {
    return json({ error: "This password can't be read. Delete it and let the agent create a new login." }, 500);
  }
}
