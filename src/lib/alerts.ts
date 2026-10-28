import "server-only";

/**
 * Email the admin when something in Vantage stops (opened by the database's health check). Uses Resend when
 * RESEND_API_KEY and ALERT_EMAIL are set; otherwise alerts only show on the admin Health page.
 */
export async function emailAlerts(alerts: { key: string; message: string }[]): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!alerts.length) return { sent: false, reason: "nothing to send" };
  if (!key || !to) return { sent: false, reason: "email not configured (set RESEND_API_KEY and ALERT_EMAIL)" };
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://vantagejobapply.onrender.com").replace(/\/$/, "");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">
    <p><b>Something in Vantage needs a look.</b></p>
    <ul>${alerts.map((a) => `<li style="margin:6px 0">${esc(a.message)}</li>`).join("")}</ul>
    <p><a href="${site}/admin?tab=health">Open System health</a></p>
    <p style="color:#666;font-size:12px">You get one email per problem; it closes by itself when things recover.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_FROM || "Vantage <onboarding@resend.dev>",
      to: to.split(",").map((x) => x.trim()).filter(Boolean),
      subject: alerts.length === 1 ? `Vantage: ${alerts[0].message.slice(0, 90)}` : `Vantage: ${alerts.length} things need a look`,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  return r.ok ? { sent: true } : { sent: false, reason: `email service answered ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}` };
}
