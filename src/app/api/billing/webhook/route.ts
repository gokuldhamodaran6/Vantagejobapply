import { verifyStripeSignature } from "@/lib/stripe";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { json } from "@/lib/server-user";

type Obj = {
  customer?: string;
  customer_email?: string;
  customer_details?: { email?: string };
  status?: string;
  metadata?: { plan?: string };
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
};

export async function POST(req: Request) {
  const payload = await req.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) return json({ error: "bad signature" }, 400);
  const event = JSON.parse(payload) as { type: string; data: { object: Obj } };
  const o = event.data.object;
  const supa = supabaseAnon();
  const set = (plan: string, status: string, renews: number | null | undefined) =>
    supa.rpc("set_plan", {
      secret: ingestSecret(),
      p_email: o.customer_details?.email || o.customer_email || null,
      p_customer: o.customer || null,
      p_plan: plan,
      p_status: status,
      p_renews: renews ? new Date(renews * 1000).toISOString() : null,
    });

  if (event.type === "checkout.session.completed") {
    await set(o.metadata?.plan || "pro", "active", null);
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const active = ["active", "trialing", "past_due"].includes(o.status || "");
    const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
    await set(active ? o.metadata?.plan || "pro" : "free", o.status || "active", end);
  } else if (event.type === "customer.subscription.deleted") {
    await set("free", "canceled", null);
  }
  return json({ received: true });
}
