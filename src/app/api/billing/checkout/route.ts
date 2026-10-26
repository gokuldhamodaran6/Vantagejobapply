import { json, loadUserContext } from "@/lib/server-user";
import { priceIds, stripe, stripeConfigured } from "@/lib/stripe";
import { PPP_COUNTRIES, priceKey, type Interval, type PlanId } from "@/lib/plans";

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  if (!stripeConfigured()) return json({ error: "Payments aren't switched on yet. Please check back soon." }, 503);
  const { plan, interval } = (await req.json().catch(() => ({}))) as { plan?: PlanId; interval?: Interval };
  if (!plan || plan === "free" || !interval) return json({ error: "Choose a plan." }, 400);

  const region = PPP_COUNTRIES.includes(ctx.profile.home_country || "") ? "ppp" : "std";
  const price = priceIds()[priceKey(plan, interval, region)];
  if (!price) return json({ error: "That plan isn't available yet." }, 400);

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/app/settings?upgraded=1#billing`,
    cancel_url: `${origin}/app/settings#billing`,
    client_reference_id: ctx.user.id,
    allow_promotion_codes: "true",
    "metadata[plan]": plan,
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][user_id]": ctx.user.id,
  };
  if (ctx.profile.stripe_customer_id) params.customer = ctx.profile.stripe_customer_id;
  else params.customer_email = ctx.profile.email;

  try {
    const session = await stripe<{ url: string }>("checkout/sessions", params);
    return json({ url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't start checkout." }, 500);
  }
}
