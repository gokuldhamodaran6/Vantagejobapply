import { json, loadUserContext } from "@/lib/server-user";
import { stripe, stripeConfigured } from "@/lib/stripe";

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  if (!stripeConfigured() || !ctx.profile.stripe_customer_id) return json({ error: "No subscription to manage yet." }, 400);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  try {
    const s = await stripe<{ url: string }>("billing_portal/sessions", { customer: ctx.profile.stripe_customer_id, return_url: `${origin}/app/settings#billing` });
    return json({ url: s.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't open billing." }, 500);
  }
}
