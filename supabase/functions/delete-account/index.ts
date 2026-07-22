// ============================================================
// Smittenbrot — delete-account Edge Function
// ============================================================
// Self-service account deletion (GDPR Art. 17 "right to erasure").
//
// A logged-in customer can delete their own account. Identity is taken
// from the caller's JWT, so a user can only ever delete themselves.
//
// What gets DELETED (personal data, no retention duty):
//   - the Supabase Auth user  → cascades: customers row, subscriptions,
//     subscription_items (all hard-deleted); orders / notifications /
//     discount_usage / audit_log have their customer_id/performed_by SET NULL.
//   - the Stripe customer      → removes the saved payment method(s).
//   - un-invoiced orders       → "Vorgemerkt"/scheduled orders that were
//     never charged (invoice_number IS NULL) and thus carry no retention
//     duty; their order_items cascade.
//
// What gets RETAINED but BLOCKED (Art. 17(3)(b) GDPR + § 147 AO / § 257 HGB):
//   - paid orders, order_items and credit_notes keep their own
//     customer_name / customer_email snapshot. German tax law requires
//     invoices / booking receipts to be kept for 8 years (Bürokratie-
//     entlastungsgesetz IV, from 01.01.2025). These records survive the
//     deletion (customer_id is nulled) and must be used only for that
//     accounting purpose.
//
// Requires an authenticated user. The admin account cannot be deleted here.
// ============================================================

import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "sophia@smittenbrot.de";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const SENDER_EMAIL = "info@smittenbrot.de";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** Confirmation email — plain, on-brand, no emojis (see email conventions). */
function confirmationHtml(name: string): string {
  const greeting = name ? `Hallo ${name},` : "Hallo,";
  return `<!DOCTYPE html><html lang="de"><body style="margin:0;padding:0;background:#ffffff;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:18px;font-weight:700;color:#f8120e;margin:0 0 24px;">Smittenbrot</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">dein Smittenbrot-Konto wurde auf deinen Wunsch gelöscht. Deine persönlichen Daten (Profil, gespeicherte Zahlungsmethode, Abonnements) wurden entfernt.</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Aus gesetzlichen Gründen (§ 147 AO, § 257 HGB) müssen wir Rechnungen und steuerrelevante Belege acht Jahre aufbewahren. Diese Daten sind gesperrt und werden ausschließlich zu diesem Zweck genutzt.</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">Danke, dass du bei uns Brot gekauft hast. Du bist jederzeit wieder willkommen.</p>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">Smittenbrot · info@smittenbrot.de</p>
  </div>
</body></html>`;
}

async function sendConfirmationEmail(to: string, name: string): Promise<void> {
  if (!BREVO_API_KEY || !to) return;
  try {
    await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: "Smittenbrot" },
        to: [{ email: to }],
        subject: "Dein Smittenbrot-Konto wurde gelöscht",
        htmlContent: confirmationHtml(name),
      }),
    });
  } catch (err) {
    console.error("[delete-account] confirmation email failed:", err);
  }
}

async function sendAdminAlert(message: string): Promise<void> {
  try {
    await fetch(
      `${SUPABASE_URL}/functions/v1/notification-dispatch/send-admin-alert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ message }),
      },
    );
  } catch {
    // non-critical
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Authenticate the caller from their JWT ──
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user || !user.email) {
    return json({ error: "Nicht angemeldet." }, 401);
  }
  const userId = user.id;

  // ── Load the customer profile (for Stripe id + email/name) ──
  const { data: customer } = await admin
    .from("customers")
    .select("email, name, stripe_customer_id, is_admin")
    .eq("id", userId)
    .maybeSingle();

  // ── Never delete the admin account via this endpoint ──
  const isAdmin =
    customer?.is_admin === true ||
    user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (isAdmin) {
    return json(
      { error: "Das Administrator-Konto kann hier nicht gelöscht werden." },
      403,
    );
  }

  const email = customer?.email ?? user.email;
  const name = customer?.name ?? "";
  const stripeCustomerId = customer?.stripe_customer_id as string | null | undefined;

  // ── 1. Delete un-invoiced orders (no retention duty; order_items cascade) ──
  const { error: ordErr } = await admin
    .from("orders")
    .delete()
    .eq("customer_id", userId)
    .is("invoice_number", null);
  if (ordErr) {
    console.error("[delete-account] failed deleting un-invoiced orders:", ordErr);
    return json({ error: "Löschen fehlgeschlagen. Bitte später erneut versuchen." }, 500);
  }

  // ── 2. Delete the Stripe customer (removes saved cards). Best-effort. ──
  let stripeWarning: string | null = null;
  if (stripeCustomerId) {
    try {
      await stripe.customers.del(stripeCustomerId);
    } catch (err) {
      stripeWarning = err instanceof Error ? err.message : String(err);
      console.error("[delete-account] Stripe customer delete failed:", stripeWarning);
    }
  }

  // ── 3. Delete the Auth user → cascades customers/subscriptions, nulls orders ──
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("[delete-account] auth.admin.deleteUser failed:", delErr);
    return json({ error: "Konto konnte nicht gelöscht werden. Bitte später erneut versuchen." }, 500);
  }

  // ── 4. Notify (best-effort, after successful deletion) ──
  await sendConfirmationEmail(email, name);
  await sendAdminAlert(
    `Konto gelöscht: ${email}` +
      (stripeWarning
        ? ` — ACHTUNG: Stripe-Kunde ${stripeCustomerId} konnte NICHT gelöscht werden (${stripeWarning}). Bitte manuell im Stripe-Dashboard löschen.`
        : ""),
  );

  return json({ success: true, stripe_warning: stripeWarning });
});
