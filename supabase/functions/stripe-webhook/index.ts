// ============================================================
// Smittenbrot — Stripe Webhook Edge Function
// ============================================================
// Validates Stripe webhook signatures and processes:
//   - payment_intent.succeeded
//   - payment_intent.payment_failed
//   - charge.refunded
//
// Returns 200 OK immediately, processes asynchronously.
// Uses natural idempotency by checking current order state
// before applying changes (duplicate events are no-ops).
// ============================================================

import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

/** Money, German-style: 4,00 € — comma decimal, symbol after the amount. */
function eur(cents: number): string {
  return `${((cents ?? 0) / 100).toFixed(2).replace(".", ",")} €`;
}

// ── Environment Variables ────────────────────────────────────

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Clients ──────────────────────────────────────────────────

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ── Constants ────────────────────────────────────────────────

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Log an entry to the audit_log table.
 * Uses the service-role client so RLS is bypassed.
 */
async function logAudit(
  action: string,
  entityType: string,
  entityId: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_data: oldData,
    new_data: newData,
    // Stripe webhook events are system-triggered — no authenticated user.
    performed_by: null,
  });

  if (error) {
    console.error(`[stripe-webhook] Failed to write audit_log for ${action}:`, error);
  }
}

/**
 * Insert a notification record.
 */
async function insertNotification(
  customerId: string | null,
  type: string,
  channel: string,
  delivered = false,
  failure: string | null = null,
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    customer_id: customerId,
    type,
    channel,
    sent_at: new Date().toISOString(),
    delivered,
    error: failure,
  });

  if (error) {
    console.error(`[stripe-webhook] Failed to insert notification (${type}):`, error);
  }
}

/**
 * Record the outcome of a receipt/invoice email.
 *
 * The receipt email doubles as the customer's invoice, so a silent failure is
 * serious: the money is taken and nothing tells anyone the paperwork never
 * arrived. Console logs alone are not enough — edge-function log retention is
 * short and not queryable after the fact — so every attempt lands in
 * `notifications` with delivered=true/false and the reason on failure. The
 * order number goes into the error text because the table has no order_id.
 */
async function logReceiptOutcome(
  order: Record<string, unknown>,
  delivered: boolean,
  reason: string | null = null,
): Promise<void> {
  const ref = (order.order_number as string | null) ?? (order.id as string);
  await insertNotification(
    (order.customer_id as string | null) ?? null,
    "order_receipt",
    "email",
    delivered,
    delivered ? null : `${ref}: ${reason ?? "unknown error"}`,
  );
}

/**
 * Tell the owner a paid order just landed — email + push to the admin phones.
 *
 * Nothing here alerted the admin at all before: the in-app "ka-ching" listens
 * on Supabase Realtime, which only reaches an app that is currently open, so a
 * closed phone stayed silent. Best-effort; never blocks the order.
 */
async function alertAdminNewOrder(order: Record<string, unknown>): Promise<void> {
  const ref = (order.order_number as string | null) ?? (order.id as string);
  const eur = (((order.total_cents as number) ?? 0) / 100).toFixed(2).replace(".", ",");
  const who = (order.customer_name as string | null) ?? "Kunde";
  const day = (order.fulfillment_date as string | null) ?? "";
  const message = `Neue Bestellung ${ref}: ${eur} EUR von ${who}, Abholung ${day}.`;
  try {
    const resp = await fetch(
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
    if (!resp.ok) {
      console.error(
        `[stripe-webhook] Admin alert failed for ${ref}: ${resp.status} ${await resp.text()}`,
      );
    }
  } catch (err) {
    console.error(`[stripe-webhook] Admin alert threw for ${ref}:`, err);
  }
}

/**
 * Send a receipt email for a paid one-time order via Brevo.
 * Errors are logged but never thrown — non-blocking.
 */
async function sendReceiptEmail(
  order: Record<string, unknown>,
): Promise<void> {
  try {
    // Only send for one-time orders
    if (order.order_type !== "one_time") {
      return;
    }

    // Resolve recipient email
    const recipientEmail = (order.customer_email as string | null) ?? "";
    if (!recipientEmail) {
      console.warn(
        `[stripe-webhook] No customer_email for order ${order.id} — skipping receipt.`,
      );
      await logReceiptOutcome(order, false, "no customer_email on the order");
      return;
    }

    if (!BREVO_API_KEY) {
      console.error(
        "[stripe-webhook] BREVO_API_KEY not configured — cannot send receipt.",
      );
      await logReceiptOutcome(order, false, "BREVO_API_KEY not configured");
      return;
    }

    const orderId = order.id as string;
    const orderPrefix = orderId.substring(orderId.length - 8).toUpperCase();
    const customerName = (order.customer_name as string) ?? "Kunde";
    const totalCents = order.total_cents as number;
    const totalEur = eur(totalCents);
    const discountCents = (order.discount_cents as number | null) ?? 0;
    const discountCode = (order.discount_code as string | null) ?? null;

    // Fetch order items with product names
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("quantity, unit_price_cents, product:product_id(name)")
      .eq("order_id", orderId);

    if (itemsError) {
      console.error(
        `[stripe-webhook] Failed to fetch items for order ${orderId}:`,
        itemsError,
      );
      // Continue with a simplified receipt
    }

    // Fetch pickup location name + its customer-facing pickup instructions
    let pickupName = "Abholort";
    let pickupInstructions =
      "Deine Bestellnummer steht auf der Verpackung deiner Bestellung.";
    const pickupLocationId = order.pickup_location_id as string;
    if (pickupLocationId) {
      const { data: location } = await supabase
        .from("pickup_locations")
        .select("name, address, pickup_instructions")
        .eq("id", pickupLocationId)
        .single();
      if (location) {
        pickupName = `${location.name} (${location.address})`;
        if (location.pickup_instructions) {
          pickupInstructions = location.pickup_instructions as string;
        }
      }
    }

    const fulfillmentDate = order.fulfillment_date as string;

    // Build items HTML table
    let itemsHtml = "";
    let subtotalCents = 0;
    if (items && items.length > 0) {
      for (const item of items) {
        const productName =
          (item.product as { name?: string } | null)?.name ?? "Unbekanntes Produkt";
        const lineTotal = item.unit_price_cents * item.quantity;
        subtotalCents += lineTotal;
        itemsHtml += `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${item.quantity}× ${productName}</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${eur(lineTotal)}</td>
          </tr>`;
      }
    }

    // Numeric dates always dd.mm.yyyy.
    const formatIsoDe = (iso: string): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
      return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? "");
    };
    const orderDateDe = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin",
    }).format(new Date());
    const fulfillmentDe = formatIsoDe(fulfillmentDate);
    const netCents = (order.net_total_cents as number) || Math.round(totalCents / 1.07);
    const vatCents = (order.vat_total_cents as number) || (totalCents - netCents);
    const orderNumber = (order.order_number as string) || orderPrefix;
    const invoiceNumber = (order.invoice_number as string) || orderPrefix;

    const subject = `Deine Smittenbrot Bestellbestätigung ${orderNumber}`;

    const htmlContent = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1A1A1A;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #f8120e; font-size: 24px; margin: 0;">Smittenbrot</h1>
          <p style="color: #6B7280; font-size: 14px; margin: 4px 0 0;">Sauerteig aus Stockdorf</p>
        </div>

        <h2 style="color: #1A1A1A; font-size: 20px;">Vielen Dank für deine Bestellung</h2>

        <p style="color: #1A1A1A;">Hallo ${customerName},</p>
        <p style="color: #1A1A1A;">deine Zahlung ist erfolgreich eingegangen. Diese Bestellbestätigung gilt zugleich als deine Rechnung.</p>

        <div style="font-size: 13px; color: #6B7280; line-height: 1.6; margin: 16px 0;">
          <strong style="color: #1A1A1A;">Smittenbrot</strong> · Sophia Smittenberg<br>
          Waldstr. 1, 82131 Stockdorf<br>
          USt-IdNr: DE453765806 · info@smittenbrot.de
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Rechnungsnummer:</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Bestellnummer:</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${orderNumber}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Rechnungsdatum:</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${orderDateDe}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Leistungsdatum (Abholung):</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${fulfillmentDe}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Abholort:</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${pickupName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; font-size: 14px;"><strong>Kunde:</strong></td>
            <td style="padding: 4px 0; text-align: right; font-size: 14px;">${customerName}</td>
          </tr>
        </table>

        <h3 style="color: #1A1A1A; font-size: 16px; border-bottom: 2px solid #f8120e; padding-bottom: 6px;">Bestellübersicht</h3>

        <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
          <thead>
            <tr style="background: #F3F4F6;">
              <th style="padding: 10px; text-align: left; font-size: 14px;">Produkt</th>
              <th style="padding: 10px; text-align: right; font-size: 14px;">Preis</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            ${discountCents > 0 ? `
            <tr>
              <td style="padding: 6px 0 2px; font-size: 14px;">Zwischensumme</td>
              <td style="padding: 6px 0 2px; text-align: right; font-size: 14px;">${eur(subtotalCents)}</td>
            </tr>
            <tr>
              <td style="padding: 2px 0; font-size: 14px;">Rabatt${discountCode ? ` (${discountCode})` : ""}</td>
              <td style="padding: 2px 0; text-align: right; font-size: 14px;">-${eur(discountCents)}</td>
            </tr>` : ""}
            <tr>
              <td style="padding: 6px 0 2px; font-size: 14px; color: #6B7280;">Nettobetrag</td>
              <td style="padding: 6px 0 2px; text-align: right; font-size: 14px; color: #6B7280;">${eur(netCents)}</td>
            </tr>
            <tr>
              <td style="padding: 2px 0; font-size: 14px; color: #6B7280;">MwSt. (7 %)</td>
              <td style="padding: 2px 0; text-align: right; font-size: 14px; color: #6B7280;">${eur(vatCents)}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0 4px; font-size: 14px;"><strong>Gesamtsumme</strong></td>
              <td style="padding: 10px 0 4px; text-align: right; font-size: 16px; font-weight: bold; color: #f8120e;">${totalEur}</td>
            </tr>
          </tfoot>
        </table>

        <div style="background: #F3F4F6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 13px; color: #1A1A1A;">
          <p style="margin: 0 0 8px;"><strong>Abholinformation</strong></p>
          <p style="margin: 0;">
            Deine Bestellung ist ab dem <strong>${fulfillmentDe}</strong> abholbereit.<br>
            ${pickupInstructions}
          </p>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0 20px;">

        <div style="text-align: center; color: #6B7280; font-size: 12px;">
          <p style="margin: 4px 0;">Smittenbrot – Sauerteig aus Stockdorf</p>
          <p style="margin: 4px 0;">info@smittenbrot.de</p>
        </div>
      </div>
    `.trim();

    const payload = {
      sender: { email: "info@smittenbrot.de", name: "Smittenbrot" },
      to: [{ email: recipientEmail }],
      subject,
      htmlContent,
    };

    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json();
      console.error(
        `[stripe-webhook] Brevo API error (${response.status}) sending receipt to ${recipientEmail}:`,
        JSON.stringify(body),
      );
      await logReceiptOutcome(
        order,
        false,
        `Brevo ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
      );
      return;
    }

    console.log(
      `[stripe-webhook] Receipt email sent to ${recipientEmail} for order ${orderId} (subject: "${subject}").`,
    );
    await logReceiptOutcome(order, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe-webhook] Failed to send receipt email for order ${order.id}: ${msg}`,
    );
    await logReceiptOutcome(order, false, msg);
  }
}

/**
 * Find an order by its Stripe PaymentIntent ID.
 */
async function findOrderByPaymentIntent(
  paymentIntentId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (error) {
    console.error(
      `[stripe-webhook] Error querying order for PI ${paymentIntentId}:`,
      error,
    );
    return null;
  }

  return data ?? null;
}

/**
 * Create a one-time order from a succeeded PaymentIntent's metadata.
 *
 * Called only when NO order exists yet for the PI — i.e. an app/website
 * one-time checkout. Per the bakery's model, the order comes into
 * existence ONLY on payment success (a failed payment leaves nothing).
 *
 * The order is inserted as payment_status='pending' then updated to
 * 'paid' so the `trg_assign_order_numbers` trigger assigns the
 * order_number (#00124…) and invoice_number (RE-00124…). Idempotent via
 * the metadata idempotency_key + the orders.idempotency_key UNIQUE index.
 */
async function createOrderFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const md = (paymentIntent.metadata ?? {}) as Record<string, string>;
  // Items may be split across items, items_1, items_2, … to stay under Stripe's
  // 500-char-per-value metadata cap. Reassemble the chunks in order.
  let itemsRaw = md.items ?? "";
  for (let i = 1; md[`items_${i}`] !== undefined; i++) {
    itemsRaw += md[`items_${i}`];
  }

  // No items metadata ⇒ not a one-time checkout PI (e.g. a subscription
  // off-session charge whose order simply isn't linked yet). Skip safely.
  if (!itemsRaw) {
    console.warn(
      `[stripe-webhook] PI ${paymentIntent.id} has no order and no items metadata — skipping.`,
    );
    return;
  }

  const idempotencyKey = md.idempotency_key || null;

  // Idempotency: skip if this order was already created (event redelivery).
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      console.log(
        `[stripe-webhook] Order for idempotency_key ${idempotencyKey} already exists — skipping.`,
      );
      return;
    }
  }

  let lineItems: Array<{ p: string; q: number; u: number }>;
  try {
    lineItems = JSON.parse(itemsRaw);
  } catch {
    console.error(`[stripe-webhook] PI ${paymentIntent.id}: invalid items metadata.`);
    return;
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    console.error(`[stripe-webhook] PI ${paymentIntent.id}: empty items metadata.`);
    return;
  }

  // The authoritative amount actually charged (already discount-adjusted).
  // Equals sum(u*q) for the app (no discounts); for website orders with a
  // discount code it is the reduced total.
  const totalCents = paymentIntent.amount;

  // Optional discount metadata (website checkout only; absent for the app).
  const discountId = md.discount_id || null;
  const discountCents = Number(md.discount_cents) || 0;
  const discountCode = md.discount_code || null;

  // orders.customer_id is a foreign key to customers(id). If the profile row is
  // missing, the insert below would fail and the money would be charged with no
  // order to show for it. Migration 016 makes the row appear automatically for
  // every new account, so this should never trigger — but never lose a paid
  // order over it: fall back to an unlinked order (the customer_email/name
  // snapshot keeps the invoice valid) and flag it for the owner.
  let customerId = md.customer_id || null;
  if (customerId) {
    const { data: profile } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (!profile) {
      console.error(
        `[stripe-webhook] PI ${paymentIntent.id}: no customers row for ${customerId} — creating the order unlinked.`,
      );
      customerId = null;
    }
  }

  // 1. Insert the order as pending (numbering trigger fires on the paid transition).
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      stripe_payment_intent_id: paymentIntent.id,
      customer_id: customerId,
      customer_email: md.customer_email || null,
      customer_name: md.customer_name || null,
      total_cents: totalCents,
      fulfillment_date: md.fulfillment_date,
      pickup_location_id: md.pickup_location_id || null,
      status: "scheduled",
      payment_status: "pending",
      order_type: "one_time",
      discount_id: discountId,
      discount_cents: discountCents,
      discount_code: discountCode,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error(
      `[stripe-webhook] Failed to create order for PI ${paymentIntent.id}:`,
      orderErr,
    );
    // The customer has been charged but has no order. Leave a durable trace —
    // a console line alone is invisible after the fact.
    await logAudit("order_creation_failed", "payment_intent", paymentIntent.id, null, {
      amount_cents: paymentIntent.amount,
      customer_email: md.customer_email ?? null,
      customer_id: md.customer_id ?? null,
      error: orderErr?.message ?? "unknown",
    });
    return;
  }

  // 2. Order items.
  const orderItems = lineItems.map((li) => ({
    order_id: order.id,
    product_id: li.p,
    quantity: li.q,
    unit_price_cents: li.u,
  }));
  const { error: oiErr } = await supabase.from("order_items").insert(orderItems);
  if (oiErr) {
    console.error(
      `[stripe-webhook] Failed to insert order_items for order ${order.id}:`,
      oiErr,
    );
  }

  // 3. Flip to paid → assigns order_number + invoice_number via trigger.
  //
  // NOTE: inserting the order_items above fired trg_update_order_totals, which
  // recomputes net/vat/total_cents from the GROSS line items — i.e. the
  // UNDISCOUNTED subtotal. When a discount applies we must override those with
  // the amount actually charged (paymentIntent.amount), so the stored order and
  // the invoice match the charge. All products are 7% VAT, so net = gross/1.07.
  const paidUpdate: Record<string, unknown> = {
    payment_status: "paid",
    updated_at: new Date().toISOString(),
  };
  if (discountCents > 0) {
    const netCents = Math.round(totalCents / 1.07);
    paidUpdate.total_cents = totalCents;
    paidUpdate.net_total_cents = netCents;
    paidUpdate.vat_total_cents = totalCents - netCents;
  }
  const { error: paidErr } = await supabase
    .from("orders")
    .update(paidUpdate)
    .eq("id", order.id);
  if (paidErr) {
    console.error(
      `[stripe-webhook] Failed to mark created order ${order.id} paid:`,
      paidErr,
    );
    return;
  }

  await logAudit("payment_intent.succeeded", "order", order.id as string, null, {
    created: true,
    payment_status: "paid",
    total_cents: totalCents,
  });

  // 3b. Record discount usage so max_uses / per-customer limits actually
  // enforce on future orders (validation reads this table).
  if (discountId) {
    const { error: duErr } = await supabase.from("discount_usage").insert({
      discount_id: discountId,
      customer_id: md.customer_id || null,
      order_id: order.id,
      email: md.customer_email || null,
    });
    if (duErr) {
      console.error(
        `[stripe-webhook] Failed to record discount_usage for order ${order.id}:`,
        duErr,
      );
    }
  }

  // 4. Receipt (re-fetch to include the assigned numbers).
  const { data: full } = await supabase
    .from("orders")
    .select("*")
    .eq("id", order.id)
    .single();
  if (full) {
    await sendReceiptEmail(full);
    await alertAdminNewOrder(full);
  }

  console.log(
    `[stripe-webhook] Created + paid one-time order ${order.id} from PI ${paymentIntent.id}.`,
  );
}

// ── Event Handlers ───────────────────────────────────────────

/**
 * payment_intent.succeeded
 *
 * Marks the associated order as payment_status='paid'.
 * Does NOT change fulfillment status — that is managed independently.
 * Naturally idempotent: skips if payment_status is already 'paid'.
 */
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const piId = paymentIntent.id;

  const order = await findOrderByPaymentIntent(piId);
  if (!order) {
    // No pre-existing order ⇒ one-time checkout. Per the bakery's model,
    // the order is created ONLY now that payment has succeeded.
    await createOrderFromPaymentIntent(paymentIntent);
    return;
  }

  // Idempotency check: if already paid, do nothing.
  if (order.payment_status === "paid") {
    console.log(
      `[stripe-webhook] Order ${order.id} already paid. Skipping duplicate event.`,
    );
    return;
  }

  const oldData: Record<string, unknown> = {
    payment_status: order.payment_status,
  };
  const newData: Record<string, unknown> = {
    payment_status: "paid",
  };

  const { error } = await supabase
    .from("orders")
    .update({ payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  if (error) {
    console.error(
      `[stripe-webhook] Failed to update order ${order.id} to paid:`,
      error,
    );
    return;
  }

  await logAudit(
    "payment_intent.succeeded",
    "order",
    order.id as string,
    oldData,
    newData,
  );

  console.log(
    `[stripe-webhook] Order ${order.id} marked as paid (PI: ${piId}).`,
  );

  // Send receipt email for one-time orders (non-blocking)
  // Re-fetch order to get updated fields (invoice_number assigned by trigger)
  const { data: updatedOrder } = await supabase
    .from("orders")
    .select("*")
    .eq("id", order.id)
    .single();
  if (updatedOrder) {
    await sendReceiptEmail(updatedOrder);
    await alertAdminNewOrder(updatedOrder);
  } else {
    await sendReceiptEmail(order);
    await alertAdminNewOrder(order);
  }
}

/**
 * payment_intent.payment_failed
 *
 * Marks the associated order as payment_status='failed'.
 * If the order belongs to a subscription, sets the subscription
 * status to 'payment_failed'.
 * Logs to audit_log and creates a payment_failed notification.
 * Naturally idempotent: skips if payment_status is already 'failed'.
 */
async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const piId = paymentIntent.id;

  const order = await findOrderByPaymentIntent(piId);
  if (!order) {
    console.warn(
      `[stripe-webhook] No order found for PaymentIntent ${piId}. Skipping.`,
    );
    return;
  }

  // Idempotency check: if already failed, do nothing.
  if (order.payment_status === "failed") {
    console.log(
      `[stripe-webhook] Order ${order.id} already failed. Skipping duplicate event.`,
    );
    return;
  }

  const oldData: Record<string, unknown> = {
    payment_status: order.payment_status,
  };
  const newData: Record<string, unknown> = {
    payment_status: "failed",
  };

  // 1. Update order payment_status
  const { error: orderError } = await supabase
    .from("orders")
    .update({ payment_status: "failed", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  if (orderError) {
    console.error(
      `[stripe-webhook] Failed to update order ${order.id} to failed:`,
      orderError,
    );
    return;
  }

  // 2. If subscription order, mark subscription as payment_failed
  if (order.subscription_id && order.order_type === "subscription") {
    const { error: subError } = await supabase
      .from("subscriptions")
      .update({
        status: "payment_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.subscription_id);

    if (subError) {
      console.error(
        `[stripe-webhook] Failed to update subscription ${order.subscription_id} to payment_failed:`,
        subError,
      );
    }
  }

  // 3. Create a payment_failed notification
  await insertNotification(
    (order.customer_id as string | null) ?? null,
    "payment_failed",
    "both",
  );

  // 4. Audit log
  await logAudit(
    "payment_intent.payment_failed",
    "order",
    order.id as string,
    oldData,
    newData,
  );

  console.log(
    `[stripe-webhook] Order ${order.id} marked as failed (PI: ${piId}).`,
  );
}

/**
 * charge.refunded
 *
 * Marks the associated order as payment_status='refunded' and
 * status='refunded'.
 * Naturally idempotent: skips if payment_status is already 'refunded'.
 */
async function handleChargeRefunded(
  charge: Stripe.Charge,
): Promise<void> {
  const piId = charge.payment_intent as string;

  const order = await findOrderByPaymentIntent(piId);
  if (!order) {
    console.warn(
      `[stripe-webhook] No order found for PaymentIntent ${piId}. Skipping.`,
    );
    return;
  }

  // Idempotency check: if already refunded, do nothing.
  if (order.payment_status === "refunded") {
    console.log(
      `[stripe-webhook] Order ${order.id} already refunded. Skipping duplicate event.`,
    );
    return;
  }

  const oldData: Record<string, unknown> = {
    payment_status: order.payment_status,
    status: order.status,
  };
  const newData: Record<string, unknown> = {
    payment_status: "refunded",
    status: "refunded",
  };

  const { error } = await supabase
    .from("orders")
    .update({
      payment_status: "refunded",
      status: "refunded",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (error) {
    console.error(
      `[stripe-webhook] Failed to update order ${order.id} to refunded:`,
      error,
    );
    return;
  }

  await logAudit(
    "charge.refunded",
    "order",
    order.id as string,
    oldData,
    newData,
  );

  console.log(
    `[stripe-webhook] Order ${order.id} marked as refunded (PI: ${piId}, charge: ${charge.id}).`,
  );
}

// ── Webhook Dispatcher ───────────────────────────────────────

/**
 * Route a verified Stripe event to its handler.
 *
 * Returns true if the event type is one we handle, false otherwise.
 */
function dispatchEvent(event: Stripe.Event): boolean {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      // Fire-and-forget — 200 has already been returned.
      handlePaymentIntentSucceeded(paymentIntent);
      return true;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      handlePaymentIntentFailed(paymentIntent);
      return true;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      handleChargeRefunded(charge);
      return true;
    }

    default:
      return false;
  }
}

// ── HTTP Handler ─────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify Stripe webhook signature
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(
      JSON.stringify({ error: "Missing stripe-signature header" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    console.error("[stripe-webhook] Signature verification failed:", message);
    return new Response(JSON.stringify({ error: `Webhook Error: ${message}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return 200 immediately — handlers run asynchronously
  const handled = dispatchEvent(event);

  if (!handled) {
    console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
