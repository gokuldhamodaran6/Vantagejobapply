import { json, loadUserContext } from "@/lib/server-user";
import { decryptFor } from "@/lib/vault";
import { supabaseAnon } from "@/lib/supabase/server";

const UNLOCK_MS = 10 * 60 * 1000;

/**
 * Reveal one of your saved careers-site passwords: only to you, only on request, only after you confirm it's you
 * (your Vantage password, or a fresh Google sign-in), and every reveal is logged.
 */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { id, password } = (await req.json().catch(() => ({}))) as { id?: string; password?: string };
  const { data } = await ctx.supabase.from("vault_credentials").select("id,host,login,secret_enc").eq("id", id || "").maybeSingle();
  if (!data) return json({ error: "Not found" }, 404);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await ctx.supabase.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("type", "vault_reveal").gte("created_at", since);
  if ((count || 0) > 40) return json({ error: "Too many reveals in the last hour. Try again later." }, 429);

  // Step-up check: confirmed in the last 10 minutes, or confirm now.
  const { count: unlocked } = await ctx.supabase.from("usage_events").select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id).eq("type", "vault_unlock").gte("created_at", new Date(Date.now() - UNLOCK_MS).toISOString());
  if (!unlocked) {
    const { data: u } = await ctx.supabase.auth.getUser();
    const user = u.user;
    if (!user?.email) return json({ error: "Log in first." }, 401);
    const hasPassword = (user.identities || []).some((i) => i.provider === "email");
    if (hasPassword) {
      if (!password) return json({ needPassword: true, error: "Enter your Vantage password to view saved passwords." }, 401);
      const { error } = await supabaseAnon().auth.signInWithPassword({ email: user.email, password });
      if (error) return json({ needPassword: true, error: "That password isn't right." }, 401);
    } else {
      const last = Date.parse(user.last_sign_in_at || "");
      if (!last || Date.now() - last > UNLOCK_MS) return json({ reauth: true, error: "For your security, sign out and sign in again with Google, then reveal the password within 10 minutes." }, 401);
    }
    await ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "vault_unlock", meta: {} });
  }

  await ctx.supabase.from("usage_events").insert({ user_id: ctx.user.id, type: "vault_reveal", meta: { host: data.host } });
  try {
    return json({ login: data.login, password: decryptFor(ctx.user.id, data.secret_enc) });
  } catch {
    return json({ error: "This password can't be read. Delete it and let the agent create a new login." }, 500);
  }
}
