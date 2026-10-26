import { json, loadUserContext } from "@/lib/server-user";
import { decryptFor } from "@/lib/vault";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";

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

  // Unlocks and reveals are logged where only the server can read or write them (users can't add or see these rows).
  const gate = async (op: "check" | "unlock" | "reveal", host?: string) => {
    const { data, error } = await supabaseAnon().rpc("vault_gate", { secret: ingestSecret(), p_user: ctx.user.id, p_op: op, p_host: host || null });
    if (error) throw new Error(error.message);
    return data as { unlocked: boolean; reveals: number };
  };
  let state: { unlocked: boolean; reveals: number };
  try {
    state = await gate("check");
  } catch {
    return json({ error: "Couldn't check your access right now. Try again in a minute." }, 503);
  }
  if (state.reveals >= 40) return json({ error: "Too many reveals in the last hour. Try again later." }, 429);

  // Step-up check: confirmed in the last 10 minutes, or confirm now.
  if (!state.unlocked) {
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
    try {
      await gate("unlock");
    } catch {
      return json({ error: "Couldn't confirm your access right now. Try again in a minute." }, 503);
    }
  }

  try {
    await gate("reveal", data.host);
  } catch {
    return json({ error: "Couldn't log this reveal, so the password stays hidden. Try again in a minute." }, 503);
  }
  try {
    return json({ login: data.login, password: decryptFor(ctx.user.id, data.secret_enc) });
  } catch {
    return json({ error: "This password can't be read. Delete it and let the agent create a new login." }, 500);
  }
}
