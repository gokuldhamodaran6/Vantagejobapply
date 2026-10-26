import { extJson, extUser } from "@/lib/ext";

export async function GET(req: Request) {
  const u = await extUser(req);
  if (!u) return extJson({ error: "Connect the extension to your Vantage account." }, 401);
  return extJson({ name: u.profile?.full_name || "", email: u.profile?.email || "", roles: u.roles.map((r) => r.title) });
}
