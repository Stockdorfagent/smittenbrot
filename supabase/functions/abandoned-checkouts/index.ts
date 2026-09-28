/**
 * abandoned-checkouts — one friendly e-mail for a one-time checkout whose
 * payment never completed (owner, 28.09.2026, after a customer stalled at her
 * bank's 3D-Secure page and got no message from anyone).
 *
 * Runs every 30 minutes (called by subscription-engine's process-cancellations
 * cron). Looks at Stripe PaymentIntents created between 48 h and 30 min ago
 * that are still incomplete, belong to a one-time checkout (metadata.items),
 * have no paid order, and whose customer did not pay another attempt later.
 * Sends at most one mail per attempt (marked in the PI's metadata), skips
 * test accounts. Bearer = CRON_SECRET or the service-role key. `?dry=1` lists
 * without sending.
 */
import Stripe from "stripe";
import { serve } from "std/http/server";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://smittenbrot.de").replace(/\/+$/, "");
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const isTest = (email: string) => email.endsWith("@smittenbrot-test.de") || email.startsWith("google-review@");
const de = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;

/** Berlin wall-clock of the order cutoff (two days before the pickup, 22:00). */
function cutoffLabel(fulfillment: string): { open: boolean; text: string } {
  const [y, m, d] = fulfillment.split("-").map(Number);
  const cutoffUtc = new Date(Date.UTC(y, m - 1, d - 2, 20, 0)); // 22:00 CEST ≈ 20:00Z (winter: 21:00Z; a 1-h fuzz is fine for wording)
  const weekday = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][new Date(Date.UTC(y, m - 1, d - 2)).getUTCDay()];
  return { open: Date.now() < cutoffUtc.getTime(), text: `${weekday}, 22:00 Uhr` };
}

async function sendMail(to: string, firstName: string, amount: number, when: string, fulfillment: string) {
  const cut = cutoffLabel(fulfillment);
  const again = cut.open
    ? `Wenn du das Brot für ${de(fulfillment)} möchtest, bestelle einfach noch einmal, bis ${cut.text}.`
    : `Der Bestellschluss für ${de(fulfillment)} ist inzwischen vorbei. Für den nächsten Abholtag kannst du jederzeit neu bestellen.`;
  const greeting = firstName ? `Hallo ${firstName},` : "Hallo,";
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1A1A1A; font-size: 15px; line-height: 1.55;">
<p style="margin: 0 0 16px;">${greeting}</p>
<p style="margin: 0 0 16px;">beim Bezahlen deiner Bestellung vom ${when} über ${eur(amount)} wurde die Zahlung nicht abgeschlossen. Es wurde <strong>nichts abgebucht</strong>, und es ist keine Bestellung entstanden.</p>
<p style="margin: 0 0 16px;">${again}</p>
<p style="margin: 0 0 24px;"><a href="${SITE_URL}/products" style="display:inline-block;background:#1A1A1A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;">Zum Sortiment</a></p>
<p style="margin: 0 0 16px; color: #6B7280; font-size: 13px;">Falls es beim Bezahlen hakt: Karten mit Bestätigung durch die Bank (3-D Secure) brauchen den letzten Klick in der Banking-App. Bei Fragen antworte einfach auf diese E-Mail.</p>
<p style="margin: 0;">Liebe Grüße<br>Sophia</p>
</div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: { email: "info@smittenbrot.de", name: "Smittenbrot" }, to: [{ email: to }],
      subject: "Deine Bestellung wurde nicht abgeschlossen", htmlContent: html }),
  });
  return r.ok;
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = (CRON_SECRET && bearer === CRON_SECRET) || (SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (!ok) return json({ error: "Unauthorized" }, 401);
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const now = Math.floor(Date.now() / 1000);
  const list = await stripe.paymentIntents.list({ created: { gte: now - 48 * 3600, lte: now - 30 * 60 }, limit: 100 });
  const recent = await stripe.paymentIntents.list({ created: { gte: now - 48 * 3600 }, limit: 100 });
  const paidLaterBy = new Map<string, number>(); // email → latest succeeded created
  for (const p of recent.data) {
    const e = (p.metadata?.customer_email ?? "").toLowerCase();
    if (p.status === "succeeded" && e) paidLaterBy.set(e, Math.max(paidLaterBy.get(e) ?? 0, p.created));
  }
  const svc = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  const out: Record<string, unknown>[] = [];
  let sent = 0;
  for (const p of list.data) {
    const md = p.metadata ?? {};
    const email = (md.customer_email ?? "").toLowerCase();
    if (!email || isTest(email) || !md.items || md.subscription_id) continue;
    if (p.status === "succeeded" || p.status === "canceled") continue;
    if ((paidLaterBy.get(email) ?? 0) > p.created) continue; // they retried and paid
    if (md.abandoned_mail_sent) continue;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?stripe_payment_intent_id=eq.${p.id}&payment_status=eq.paid&select=id`, { headers: svc });
    if (r.ok && ((await r.json()) as unknown[]).length > 0) continue;
    const when = new Date(p.created * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
    const first = (md.customer_name ?? "").trim().split(/\s+/)[0] ?? "";
    const row = { pi: p.id, email, name: md.customer_name ?? "", amount: p.amount, created: p.created, fulfillment: md.fulfillment_date ?? "" };
    if (dry) { out.push(row); continue; }
    const okMail = await sendMail(email, first, p.amount, when, md.fulfillment_date ?? "");
    if (okMail) {
      await stripe.paymentIntents.update(p.id, { metadata: { abandoned_mail_sent: new Date().toISOString() } });
      sent++;
    }
    out.push({ ...row, mailed: okMail });
  }
  console.log(`[abandoned-checkouts] checked ${list.data.length}, ${dry ? "would mail" : "mailed"} ${dry ? out.length : sent}`);
  return json({ checked: list.data.length, sent, dry, candidates: out });
});
