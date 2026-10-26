import { json, loadUserContext } from "@/lib/server-user";
import { hashToken, newToken } from "@/lib/ext";

/** Create a key for the Chrome extension (shown once), list keys, or revoke one. Signed-in users only. */
export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const token = newToken();
  const { error } = await ctx.supabase.from("extension_tokens").insert({ user_id: ctx.user.id, token_hash: hashToken(token), label: (body.label || "Chrome").slice(0, 40) });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, token, name: ctx.profile.full_name || "", email: ctx.user.email || "" });
}

export async function GET() {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const { data } = await ctx.supabase.from("extension_tokens").select("id,label,created_at,last_used_at").order("created_at", { ascending: false });
  return json({ keys: data || [] });
}

export async function DELETE(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  await ctx.supabase.from("extension_tokens").delete().eq("id", id);
  return json({ ok: true });
}
