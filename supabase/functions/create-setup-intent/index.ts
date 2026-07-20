// ============================================================
// Smittenbrot — create-setup-intent Edge Function
// ============================================================
// Saves a card to the customer's Stripe account so subscriptions
// can be charged off-session by the subscription engine.
//
// Requires an authenticated user. Returns:
//   { hasPaymentMethod, setupIntentClientSecret, customerId, ephemeralKey }
//
// The app checks hasPaymentMethod: if false, it presents the Stripe
// PaymentSheet in setup mode (using setupIntentClientSecret) to collect
// a card BEFORE the subscription is created. A subscription must never
// exist without an active payment method.
// ============================================================

import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STRIPE_API_VERSION = "2025-08-27.basil";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user || !user.email) {
    return json({ error: "Nicht angemeldet." }, 401);
  }

  const customerName = (user.user_metadata?.name as string) ?? "";

  try {
    // Find or create the Stripe customer (keyed by email — same key the
    // subscription engine uses when charging).
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = existing.data[0]?.id ??
      (await stripe.customers.create({
        email: user.email,
        name: customerName || undefined,
        metadata: { supabase_id: user.id },
      })).id;

    // Does this customer already have a usable payment method?
    const cards = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    const sepa = await stripe.paymentMethods.list({
      customer: customerId,
      type: "sepa_debit",
      limit: 1,
    });
    const hasPaymentMethod = cards.data.length > 0 || sepa.data.length > 0;

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION },
    );

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      // Card only — a subscription needs a reliably off-session-chargeable
      // method. Excludes Link, Satispay, etc.
      payment_method_types: ["card"],
      metadata: { supabase_id: user.id },
    });

    return json({
      hasPaymentMethod,
      setupIntentClientSecret: setupIntent.client_secret,
      customerId,
      ephemeralKey: ephemeralKey.secret,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-setup-intent] error:", msg);
    return json({ error: `Zahlungsmethode konnte nicht vorbereitet werden: ${msg}` }, 500);
  }
});
