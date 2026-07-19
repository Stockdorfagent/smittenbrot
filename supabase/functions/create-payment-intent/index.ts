// ============================================================
// Smittenbrot — create-payment-intent Edge Function (app checkout)
// ============================================================
// Creates a Stripe PaymentIntent for a one-time order with:
//   - DB-authoritative pricing (client prices are never trusted)
//   - active-closure check
//   - capacity check via capacity-manager (subscription-first logic)
//
// IMPORTANT: no order is created here. Per the bakery's model, an order
// must exist ONLY when payment succeeds. The full order payload is stored
// in the PaymentIntent metadata; the stripe-webhook creates the order on
// `payment_intent.succeeded`. Payment failure ⇒ no order at all.
//
// Requires an authenticated user (app checkout = account mandatory).
// The card is saved (setup_future_usage) so subscriptions can reuse it.
//
// Response: { clientSecret, paymentIntentId, customerId, ephemeralKey, amount }
// Currency: EUR.
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

interface ItemInput {
  product_id: string;
  quantity: number;
}

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

  // ── Authenticated user (app requires an account) ──
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user || !user.email) {
    return json({ error: "Nicht angemeldet." }, 401);
  }

  // ── Parse + validate body ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const items = body.items as ItemInput[] | undefined;
  const fulfillmentDate = body.fulfillment_date as string | undefined;
  const pickupLocationId = body.pickup_location_id as string | undefined;
  const customerName =
    (body.customer_name as string) ??
    (user.user_metadata?.name as string) ??
    "";

  if (!items || items.length === 0) {
    return json({ error: "Warenkorb ist leer." }, 400);
  }
  if (!fulfillmentDate) {
    return json({ error: "fulfillment_date fehlt." }, 400);
  }
  if (!pickupLocationId) {
    return json({ error: "Abholort fehlt." }, 400);
  }

  const svcHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // ── 0. Active-closure check ──
  try {
    const cr = await fetch(`${SUPABASE_URL}/functions/v1/closure-handler/active`, {
      method: "POST",
      headers: svcHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (cr.ok) {
      const cd = await cr.json();
      if (cd.active === true) {
        return json(
          {
            error:
              cd.closure?.banner_text_de ??
              "Aktuell findet keine Produktion statt.",
          },
          503,
        );
      }
    }
  } catch {
    // closure-handler unreachable — proceed (fail-open on closure check)
  }

  // ── 1. DB-authoritative pricing + product validation ──
  const priceMap: Record<string, { price_cents: number; name: string }> = {};
  const lineItems: Array<
    { product_id: string; quantity: number; unit_price_cents: number }
  > = [];
  let subtotalCents = 0;

  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return json({ error: "Ungültige Menge." }, 400);
    }

    const { data: product } = await admin
      .from("products")
      .select("id, name, price_cents, active")
      .eq("id", item.product_id)
      .single();

    if (!product || !product.active) {
      return json({ error: "Ein Produkt ist nicht (mehr) verfügbar." }, 400);
    }

    priceMap[product.id] = {
      price_cents: product.price_cents,
      name: product.name,
    };
    lineItems.push({
      product_id: product.id,
      quantity: qty,
      unit_price_cents: product.price_cents,
    });
    subtotalCents += product.price_cents * qty;
  }

  // ── 2. Capacity check (reuses capacity-manager: subscription-first) ──
  const capErrors: string[] = [];
  for (const item of items) {
    try {
      const rc = await fetch(
        `${SUPABASE_URL}/functions/v1/capacity-manager/reserve-capacity`,
        {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({
            product_id: item.product_id,
            fulfillment_date: fulfillmentDate,
            quantity: Number(item.quantity),
          }),
        },
      );
      const rd = await rc.json();
      if (!rc.ok || rd.available !== true) {
        capErrors.push(
          `${priceMap[item.product_id]?.name ?? item.product_id}: ausverkauft`,
        );
      }
    } catch {
      return json({ error: "Kapazitätsprüfung fehlgeschlagen." }, 502);
    }
  }
  if (capErrors.length > 0) {
    return json(
      {
        error: "capacity_exceeded",
        message: "Einige Produkte sind für diesen Tag leider ausverkauft.",
        details: capErrors,
      },
      409,
    );
  }

  try {
    // ── 3. Stripe customer (save the card for future subscription use) ──
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    const stripeCustomerId = existing.data[0]?.id ??
      (await stripe.customers.create({
        email: user.email,
        name: customerName || undefined,
        metadata: { supabase_id: user.id },
      })).id;

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: STRIPE_API_VERSION },
    );

    // ── 4. Encode the order payload compactly for PI metadata ──
    const itemsMeta = JSON.stringify(
      lineItems.map((li) => ({
        p: li.product_id,
        q: li.quantity,
        u: li.unit_price_cents,
      })),
    );

    // ── 5. PaymentIntent — carries the whole order in metadata so the
    //        webhook can create the order only once payment succeeds. ──
    const idempotencyKey = crypto.randomUUID();

    const metadata: Record<string, string> = {
      fulfillment_date: fulfillmentDate,
      pickup_location_id: pickupLocationId ?? "",
      customer_id: user.id,
      customer_email: user.email ?? "",
      customer_name: customerName,
      idempotency_key: idempotencyKey,
    };
    // Stripe caps each metadata value at 500 chars; split the item list across
    // items, items_1, items_2, … so large orders aren't rejected. The webhook
    // reassembles the chunks. (Stripe also caps total keys at 50.)
    const CHUNK = 450;
    if (Math.ceil(itemsMeta.length / CHUNK) > 40) {
      return json(
        { error: "Bestellung zu groß. Bitte teile sie in kleinere Bestellungen auf." },
        400,
      );
    }
    for (let i = 0; i * CHUNK < itemsMeta.length; i++) {
      metadata[i === 0 ? "items" : `items_${i}`] = itemsMeta.slice(i * CHUNK, (i + 1) * CHUNK);
    }

    const pi = await stripe.paymentIntents.create(
      {
        amount: subtotalCents,
        currency: "eur",
        customer: stripeCustomerId,
        setup_future_usage: "off_session",
        // Card only (Apple/Google Pay are card wallets surfaced by the app's
        // PaymentSheet). Excludes Link, Satispay, etc.
        payment_method_types: ["card"],
        metadata,
      },
      { idempotencyKey: `pi_${idempotencyKey}` },
    );

    return json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      customerId: stripeCustomerId,
      ephemeralKey: ephemeralKey.secret,
      amount: subtotalCents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-payment-intent] Stripe error:", msg);
    return json({ error: `Zahlung konnte nicht gestartet werden: ${msg}` }, 500);
  }
});
