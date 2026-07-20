// ============================================================
// Smittenbrot — cancel-order Edge Function (app)
// ============================================================
// Lets a customer cancel their own PAID one-time order before the
// production cutoff. On success: refunds via Stripe, marks the order
// cancelled/refunded, writes a GoBD credit note (Storno) if an invoice
// exists, and alerts the admin.
//
// Cutoff (matches the bakery's stated fulfillment rules): an order for a
// Wednesday pickup locks Monday 22:00; a Saturday pickup locks Thursday
// 22:00 — i.e. two days before the pickup date at 22:00 Europe/Berlin.
// After that the bread is in production and cannot be cancelled.
//
// Requires an authenticated user; only the order's owner may cancel it.
// ============================================================

import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
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

/** "YYYY-MM-DDTHH:MM" wall-clock in Europe/Berlin (DST-correct). */
function berlinWallClock(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/**
 * The cancellation cutoff wall-clock ("YYYY-MM-DDTHH:MM", Berlin) for a
 * given pickup date: two calendar days earlier at 22:00.
 */
function cutoffWallClock(fulfillmentDate: string): string {
  const [y, m, d] = fulfillmentDate.split("-").map(Number);
  const cal = new Date(Date.UTC(y, m - 1, d));
  cal.setUTCDate(cal.getUTCDate() - 2);
  return `${cal.toISOString().slice(0, 10)}T22:00`;
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const orderId = body.order_id as string | undefined;
  if (!orderId) {
    return json({ error: "order_id fehlt." }, 400);
  }

  // ── Load the order ──
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    return json({ error: "Bestellung nicht gefunden." }, 404);
  }

  // ── Ownership ──
  const owns = order.customer_id === user.id ||
    (order.customer_email &&
      order.customer_email.toLowerCase() === user.email.toLowerCase());
  if (!owns) {
    return json({ error: "Nicht autorisiert." }, 403);
  }

  // ── Only paid one-time orders can be self-cancelled here ──
  if (order.order_type !== "one_time") {
    return json(
      { error: "Abo-Bestellungen verwaltest du in deinen Abonnements." },
      400,
    );
  }
  if (order.status === "cancelled" || order.status === "refunded") {
    return json({ error: "Bestellung wurde bereits storniert." }, 400);
  }
  if (order.payment_status !== "paid") {
    return json({ error: "Diese Bestellung kann nicht storniert werden." }, 400);
  }

  // ── Cutoff check ──
  if (berlinWallClock(new Date()) > cutoffWallClock(order.fulfillment_date)) {
    return json(
      {
        error:
          "Stornierung nicht mehr möglich – für dich wird bereits gebacken.",
      },
      400,
    );
  }

  // ── Refund via Stripe ──
  if (order.stripe_payment_intent_id) {
    try {
      await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      console.error("[cancel-order] Stripe refund error:", msg);
      return json({ error: `Rückerstattung fehlgeschlagen: ${msg}` }, 500);
    }
  }

  // ── Mark cancelled + refunded ──
  const { error: updErr } = await admin
    .from("orders")
    .update({
      status: "cancelled",
      payment_status: "refunded",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (updErr) {
    console.error("[cancel-order] Failed to update order:", updErr);
    return json({ error: "Status-Update fehlgeschlagen." }, 500);
  }

  // ── Credit note (Storno-Rechnung) for GoBD, if an invoice exists ──
  if (order.invoice_number) {
    const netCents = Math.round(order.total_cents / 1.07);
    const vatCents = order.total_cents - netCents;
    const { error: cnErr } = await admin.from("credit_notes").insert({
      order_id: order.id,
      original_invoice_number: order.invoice_number,
      total_gross_cents: order.total_cents,
      total_net_cents: netCents,
      total_vat_cents: vatCents,
      vat_rate: 0.07,
      reason: `Stornierung der Rechnung ${order.invoice_number}`,
    });
    if (cnErr) {
      console.error("[cancel-order] Failed to create credit note:", cnErr);
      // non-critical — refund already processed
    }
  }

  // ── Admin alert (via notification-dispatch) ──
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatch/send-admin-alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        message:
          `Stornierung: Bestellung ${order.order_number ?? orderId.substring(0, 8)} ` +
          `(${order.customer_email ?? "?"}) über ` +
          `€${(order.total_cents / 100).toFixed(2)} wurde storniert und zurückerstattet.`,
      }),
    });
  } catch {
    // non-critical
  }

  return json({ success: true });
});
