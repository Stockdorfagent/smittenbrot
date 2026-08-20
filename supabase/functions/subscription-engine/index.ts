// ============================================================
// Smittenbrot — Subscription Engine Edge Function
// ============================================================
// Processes the weekly subscription schedule:
//   - Monday/Thursday 12:00: Send subscription reminders
//   - Monday/Thursday 20:00: Auto-place subscription orders
//   - Monday/Thursday 22:00: Lock orders and charge payments
//   - Monday/Thursday 22:00: Process cancellations
//
// Time zone: Europe/Berlin
// ============================================================

import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

// ── Environment Variables ────────────────────────────────────

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
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

const TIMEZONE = "Europe/Berlin";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Format a Date as ISO date string (YYYY-MM-DD) in Europe/Berlin.
 */
function formatDateInTz(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

/**
 * Get the current date string in Europe/Berlin.
 */
function todayInTz(): string {
  return formatDateInTz(new Date());
}

/**
 * Get the current day of week (0=Sunday..6=Saturday) in Europe/Berlin.
 */
function currentDayOfWeek(): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
  });
  const dayName = formatter.format(now);
  const dayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return dayMap[dayName] ?? now.getDay();
}

/**
 * Compute the next fulfillment date (Wednesday or Saturday) based on
 * the current day/time in Europe/Berlin.
 *
 * - Monday → next Wednesday (2 days ahead)
 * - Tuesday → next Wednesday (1 day ahead)
 * - Wednesday → next Wednesday (7 days ahead — after pickup, skip to next)
 * - Thursday → next Saturday (2 days ahead)
 * - Friday → next Saturday (1 day ahead)
 * - Saturday → next Saturday (7 days ahead)
 * - Sunday → next Wednesday (3 days ahead)
 */
function getNextFulfillmentDate(): string {
  const now = new Date();
  const dow = currentDayOfWeek();

  // Compute offset days to the desired pickup day
  let offset: number;
  if (dow <= 2) {
    // Sunday(0), Monday(1), Tuesday(2) → next Wednesday
    offset = (3 - dow + 7) % 7;
    if (offset === 0) offset = 7; // if today is Wednesday, skip to next Wednesday
  } else if (dow === 3) {
    // Wednesday → next Wednesday (7 days)
    offset = 7;
  } else if (dow <= 5) {
    // Thursday(4), Friday(5) → next Saturday
    offset = (6 - dow + 7) % 7;
    if (offset === 0) offset = 7;
  } else {
    // Saturday(6) → next Saturday (7 days)
    offset = 7;
  }

  const target = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  return formatDateInTz(target);
}

/**
 * "YYYY-MM-DDTHH:MM" wall-clock in Europe/Berlin (DST-correct).
 */
function berlinWallClock(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
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
 * Current hour (0–23) in Europe/Berlin.
 *
 * Used by the cron DST guard: Supabase pg_cron only understands UTC and
 * rejects CRON_TZ, so the time-sensitive jobs are scheduled at BOTH the
 * summer and winter UTC hours (e.g. lock at 20:00 AND 21:00 UTC). Only the
 * firing whose Berlin-local hour matches the intended time does the work;
 * the other is a no-op. This keeps the 22:00 lock/charge aligned with the
 * "Bestellschluss 22:00" shown to customers year-round.
 */
function berlinHour(): number {
  return parseInt(berlinWallClock(new Date()).slice(11, 13), 10);
}

/**
 * Next date (YYYY-MM-DD, Europe/Berlin) for a SPECIFIC pickup weekday whose
 * order cutoff (two days before at 22:00) is still in the future. Used when a
 * subscription's order is generated on demand (e.g. at subscription creation).
 */
function getNextDateForPickupDay(pickupDay: "wednesday" | "saturday"): string {
  const targetDow = pickupDay === "wednesday" ? 3 : 6;
  const now = new Date();
  const nowWall = berlinWallClock(now);
  for (let i = 0; i <= 21; i++) {
    const cand = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const candStr = formatDateInTz(cand);
    const candDow = new Date(candStr + "T12:00:00Z").getUTCDay();
    if (candDow !== targetDow) continue;
    const [y, m, d] = candStr.split("-").map(Number);
    const cutoff = new Date(Date.UTC(y, m - 1, d));
    cutoff.setUTCDate(cutoff.getUTCDate() - 2);
    const cutoffWall = `${cutoff.toISOString().slice(0, 10)}T22:00`;
    if (nowWall < cutoffWall) return candStr;
  }
  return formatDateInTz(now);
}

/**
 * Get the current week type (A or B) from the week_cycle table.
 */
async function getCurrentWeekType(): Promise<"A" | "B"> {
  // There should be exactly one row in week_cycle
  const { data, error } = await supabase
    .from("week_cycle")
    .select("current_week")
    .limit(1)
    .single();

  if (error || !data) {
    console.error("[subscription-engine] Failed to get week cycle:", error);
    return "A"; // default fallback
  }

  return data.current_week as "A" | "B";
}

/**
 * Log an entry to the audit_log table using service-role client.
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
    performed_by: null, // system-triggered
  });

  if (error) {
    console.error(
      `[subscription-engine] Failed to write audit_log for ${action}:`,
      error,
    );
  }
}

/**
 * Get the fulfillment_date for an order
 */
async function getFulfillmentDateFromOrder(orderId: string): Promise<string> {
  const { data } = await supabase
    .from("orders")
    .select("fulfillment_date")
    .eq("id", orderId)
    .single();
  return data?.fulfillment_date ?? "";
}

/**
 * Build a German tax-compliant receipt HTML email for an order.
 */
function buildReceiptHtml(
  order: Record<string, unknown>,
  customer: { name: string; email: string },
  items: Array<{ quantity: number; unit_price_cents: number; name: string }>,
  invoiceNumber: string,
  fulfillmentDate: string,
  pickupInstructions: string,
): string {
  const customerName = customer.name ?? "Kunde";
  const orderNumber = (order.order_number as string) || invoiceNumber;
  const totalCents = (order.total_cents as number) ?? 0;
  const netCents = (order.net_total_cents as number) || Math.round(totalCents / 1.07);
  const vatCents = (order.vat_total_cents as number) || (totalCents - netCents);

  const formatIsoDe = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? "");
  };
  const todayDe = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin",
  }).format(new Date());

  const itemsHtml = items.map((it) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px;">${it.quantity}× ${it.name}</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 14px;">${((it.unit_price_cents * it.quantity) / 100).toFixed(2)}€</td>
          </tr>`).join("");

  return `
    <div style="font-family: 'Helvetica', 'Arial', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #1A1A1A;">
      <div style="border-bottom: 3px solid #f8120e; padding-bottom: 10px; margin-bottom: 20px;">
        <h1 style="color: #f8120e; font-size: 24px; margin: 0;">Smittenbrot</h1>
        <p style="margin: 4px 0 0; color: #6B7280; font-size: 13px;">Sauerteig aus Stockdorf</p>
      </div>

      <h2 style="font-size: 18px; color: #1A1A1A;">Bestellbestätigung &amp; Rechnung</h2>
      <p style="color: #1A1A1A; font-size: 14px;">Hallo ${customerName}, deine Abo-Bestellung wurde aufgegeben und bezahlt. Diese Bestätigung gilt zugleich als deine Rechnung.</p>

      <div style="font-size: 13px; color: #6B7280; line-height: 1.6; margin: 16px 0;">
        <strong style="color: #1A1A1A;">Smittenbrot</strong> · Sophia Smittenberg<br>
        Waldstr. 1, 82131 Stockdorf<br>
        USt-IdNr: DE453765806 · info@smittenbrot.de
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 14px;">
        <tr><td style="padding: 2px 0; color: #6B7280;">Rechnungsnummer:</td><td style="padding: 2px 0; text-align: right;">${invoiceNumber}</td></tr>
        <tr><td style="padding: 2px 0; color: #6B7280;">Bestellnummer:</td><td style="padding: 2px 0; text-align: right;">${orderNumber}</td></tr>
        <tr><td style="padding: 2px 0; color: #6B7280;">Rechnungsdatum:</td><td style="padding: 2px 0; text-align: right;">${todayDe}</td></tr>
        <tr><td style="padding: 2px 0; color: #6B7280;">Leistungsdatum (Abholung):</td><td style="padding: 2px 0; text-align: right;">${formatIsoDe(fulfillmentDate)}</td></tr>
        <tr><td style="padding: 2px 0; color: #6B7280;">Kunde:</td><td style="padding: 2px 0; text-align: right;">${customerName}</td></tr>
      </table>

      <h3 style="color: #1A1A1A; font-size: 16px; border-bottom: 2px solid #f8120e; padding-bottom: 6px;">Bestellübersicht</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
        <thead>
          <tr style="background: #F3F4F6;">
            <th style="padding: 10px; text-align: left; font-size: 14px;">Produkt</th>
            <th style="padding: 10px; text-align: right; font-size: 14px;">Preis</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr><td style="padding: 6px 0 2px; font-size: 14px; color: #6B7280;">Nettobetrag</td><td style="padding: 6px 0 2px; text-align: right; font-size: 14px; color: #6B7280;">${(netCents / 100).toFixed(2)}€</td></tr>
          <tr><td style="padding: 2px 0; font-size: 14px; color: #6B7280;">MwSt. (7 %)</td><td style="padding: 2px 0; text-align: right; font-size: 14px; color: #6B7280;">${(vatCents / 100).toFixed(2)}€</td></tr>
          <tr><td style="padding: 10px 0 4px; font-size: 14px;"><strong>Gesamtsumme</strong></td><td style="padding: 10px 0 4px; text-align: right; font-size: 16px; font-weight: bold; color: #f8120e;">${(totalCents / 100).toFixed(2)}€</td></tr>
        </tfoot>
      </table>

      <div style="background: #F3F4F6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 13px; color: #1A1A1A;">
        <p style="margin: 0 0 8px;"><strong>Abholinformation</strong></p>
        <p style="margin: 0;">Deine Bestellung ist ab dem <strong>${formatIsoDe(fulfillmentDate)}</strong> abholbereit.<br>${pickupInstructions}</p>
      </div>

      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #6B7280; text-align: center;">
        Smittenbrot · Sauerteig aus Stockdorf · info@smittenbrot.de<br>
        Es gilt die ermäßigte Mehrwertsteuer von 7 % auf Lebensmittel.
      </p>
    </div>
  `.trim();
}

/**
 * Dispatch a notification by calling the notification-dispatch edge
 * function, which actually sends push/email AND logs to the
 * notifications table.
 *
 *   - Customer notifications → POST /send-notification
 *       { customer_id, type, channel, data }
 *   - Admin alerts (customerId === null) → POST /send-admin-alert
 *       { message }
 *
 * Failures are logged but never thrown — notification delivery must
 * never break order/subscription processing.
 */
/**
 * Record the outcome of a subscription receipt/invoice email.
 *
 * The receipt doubles as the invoice, so a silent failure means the card was
 * charged and nobody knows the paperwork never arrived. Edge-function console
 * logs are short-lived and not queryable afterwards, so every attempt lands in
 * `notifications` (delivered=true/false, reason on failure). The order number
 * goes into the error text because the table has no order_id column.
 */
async function logReceiptOutcome(
  customerId: string | null,
  order: Record<string, unknown>,
  delivered: boolean,
  reason: string | null = null,
): Promise<void> {
  const ref = (order.order_number as string | null) ?? (order.id as string);
  const { error } = await supabase.from("notifications").insert({
    customer_id: customerId,
    type: "order_receipt",
    channel: "email",
    sent_at: new Date().toISOString(),
    delivered,
    error: delivered ? null : `${ref}: ${reason ?? "unknown error"}`,
  });
  if (error) {
    console.error("[subscription-engine] Failed to log receipt outcome:", error);
  }
}

async function dispatchNotification(
  customerId: string | null,
  type: string,
  channel: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const base = `${SUPABASE_URL}/functions/v1/notification-dispatch`;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    let resp: Response;
    if (customerId === null) {
      if (type !== "admin_alert") {
        console.warn(
          `[subscription-engine] Skipping notification "${type}" with no customer.`,
        );
        return;
      }
      resp = await fetch(`${base}/send-admin-alert`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: (data?.message as string) ?? "Smittenbrot: Systemhinweis.",
        }),
      });
    } else {
      resp = await fetch(`${base}/send-notification`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          customer_id: customerId,
          type,
          channel,
          data: data ?? {},
        }),
      });
    }

    if (!resp.ok) {
      console.error(
        `[subscription-engine] notification-dispatch (${type}) returned ${resp.status}: ${await resp.text()}`,
      );
    }
  } catch (err) {
    console.error(
      `[subscription-engine] Failed to dispatch notification (${type}):`,
      err,
    );
  }
}

/**
 * Find or create a Stripe customer for a given customer record.
 * Uses email as the lookup key.
 */
async function getOrCreateStripeCustomer(
  customerId: string,
  email: string,
  name: string,
): Promise<Stripe.Customer | null> {
  // First, check if there's already a stripe_customer_id stored in the customers table.
  // Note: If the customers table doesn't have a stripe_customer_id column yet,
  // this query returns null and we'll look up by email in Stripe.
  // The schema may be extended with this column in a later migration.

  // Try to find existing Stripe customer by email
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create a new Stripe customer
  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        customer_id: customerId,
      },
    });
    return customer;
  } catch (err) {
    console.error(
      `[subscription-engine] Failed to create Stripe customer for ${email}:`,
      err,
    );
    return null;
  }
}

/**
 * Get the default payment method for a Stripe customer.
 * Returns the first attached card/billing payment method, or null.
 */
async function getDefaultPaymentMethod(
  stripeCustomerId: string,
): Promise<Stripe.PaymentMethod | null> {
  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "card",
      limit: 1,
    });

    if (paymentMethods.data.length > 0) {
      return paymentMethods.data[0];
    }

    // Also check SEPA debit payment methods
    const sepaMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "sepa_debit",
      limit: 1,
    });

    if (sepaMethods.data.length > 0) {
      return sepaMethods.data[0];
    }

    return null;
  } catch (err) {
    console.error(
      `[subscription-engine] Failed to list payment methods for customer ${stripeCustomerId}:`,
      err,
    );
    return null;
  }
}

// ── Core Processing Functions ────────────────────────────────

/**
 * 1. process_12pm_reminders()
 *
 * Called at Monday/Thursday 12:00.
 * Finds all active subscriptions whose products are available on
 * the next fulfillment date. Sends push/email notification:
 * "Your subscription order will be placed tonight at 20:00."
 */
async function process12pmReminders(): Promise<{
  processed: number;
  errors: string[];
}> {
  const fulfillmentDate = getNextFulfillmentDate();
  const dow = currentDayOfWeek();
  // Determine pickup day type for filtering product availability
  const isWednesdayPickup = dow <= 2 || dow === 3; // Sun-Tue or Wed → Wed pickup
  // Actually: Monday processing = Wednesday pickup; Thursday processing = Saturday pickup
  // For reminders sent at 12:00:
  //   Monday 12:00 → Wednesday pickup, check available_wed
  //   Thursday 12:00 → Saturday pickup, check available_sat
  const pickupDayColumn = dow === 1 ? "available_wed" : "available_sat"; // Monday=1, Thursday=4

  console.log(
    `[subscription-engine] process12pmReminders: fulfillmentDate=${fulfillmentDate}, pickupDay=${pickupDayColumn}`,
  );

  // Get all active subscriptions (not paused, not cancelled)
  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_id,
      pickup_location_id,
      customers!inner (
        id,
        email,
        name,
        push_token,
        reminder_email,
        unsubscribe_token
      )
    `)
    .eq("status", "active")
    .eq("pickup_day", dow === 1 ? "wednesday" : "saturday")
    .or(`paused_until.is.null,paused_until.lt.${todayInTz()}`);

  if (subError) {
    console.error(
      "[subscription-engine] Failed to fetch active subscriptions:",
      subError,
    );
    return { processed: 0, errors: [subError.message] };
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log("[subscription-engine] No active subscriptions to remind.");
    return { processed: 0, errors: [] };
  }

  const errors: string[] = [];
  let processed = 0;
  const currentWeek = await getCurrentWeekType();

  for (const sub of subscriptions) {
    try {
      const customer = sub.customers as unknown as {
        id: string;
        email: string;
        name: string;
        push_token: string | null;
        reminder_email: boolean | null;
        unsubscribe_token: string | null;
      };

      // The items that will actually be in this week's order — respects the
      // A/B cycle + weekday availability, so bi-weekly breads only appear in
      // their week. If nothing is due this week, skip the reminder entirely.
      const { data: rawItems } = await supabase
        .from("subscription_items")
        .select(`quantity, products!inner ( name, cycle, subscribable, ${pickupDayColumn} )`)
        .eq("subscription_id", sub.id);
      const items: { name: string; quantity: number }[] = [];
      for (const it of rawItems ?? []) {
        const p = it.products as unknown as { name: string; cycle: string; subscribable: boolean; [k: string]: unknown };
        if (p.subscribable === false) continue;
        if (!p[pickupDayColumn]) continue;
        if (p.cycle === "hidden") continue;
        if (p.cycle === "week_a" && currentWeek !== "A") continue;
        if (p.cycle === "week_b" && currentWeek !== "B") continue;
        items.push({ name: p.name, quantity: it.quantity });
      }
      if (items.length === 0) continue; // no delivery for this sub this week

      // Respect the customer's email-reminder preference (default on).
      // Push (if a device token exists) is unaffected by this toggle.
      const emailOn = customer.reminder_email !== false;
      const hasPush = !!(customer.push_token && customer.push_token.trim());
      let channel: string;
      if (hasPush && emailOn) channel = "both";
      else if (hasPush) channel = "push";
      else if (emailOn) channel = "email";
      else continue; // opted out of email and no push device — nothing to send

      // Send the reminder (push/email + logging) via notification-dispatch.
      // Pass unsubscribe info so the email can include an opt-out link.
      await dispatchNotification(
        customer.id,
        "subscription_reminder",
        channel,
        {
          fulfillment_date: fulfillmentDate,
          customer_id: customer.id,
          unsubscribe_token: customer.unsubscribe_token,
          items,
        },
      );

      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Subscription ${sub.id}: ${msg}`);
      console.error(
        `[subscription-engine] Error processing reminder for subscription ${sub.id}:`,
        err,
      );
    }
  }

  console.log(
    `[subscription-engine] process12pmReminders done: ${processed} processed, ${errors.length} errors`,
  );
  return { processed, errors };
}

/**
 * 2. process_8pm_order_placement()
 *
 * Called at Monday/Thursday 20:00.
 * For each active subscription:
 *   - Check if the week cycle matches (skip Week A products in B weeks, etc.)
 *   - Create order + order_items from subscription_items
 *   - Set order status = 'grace_period_open', payment_status = 'pending'
 *   - Send notification that order was placed
 *   - Set subscription next_processing_at (if applicable)
 */
async function process8pmOrderPlacement(): Promise<{
  ordersCreated: number;
  skippedSubscriptions: number;
  errors: string[];
}> {
  const fulfillmentDate = getNextFulfillmentDate();
  const dow = currentDayOfWeek();
  // Monday → Wednesday pickup: check available_wed
  // Thursday → Saturday pickup: check available_sat
  const pickupDayColumn = dow === 1 ? "available_wed" : "available_sat";

  // Get current week type (A or B)
  const currentWeek = await getCurrentWeekType();

  console.log(
    `[subscription-engine] process8pmOrderPlacement: ` +
      `fulfillmentDate=${fulfillmentDate}, week=${currentWeek}, pickupDay=${pickupDayColumn}`,
  );

  // Get all active subscriptions (not paused, not cancelled)
  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_id,
      pickup_location_id,
      customers!inner (
        id,
        email,
        name,
        push_token,
        reminder_email,
        unsubscribe_token
      )
    `)
    .eq("status", "active")
    .eq("pickup_day", dow === 1 ? "wednesday" : "saturday")
    .or(`paused_until.is.null,paused_until.lt.${todayInTz()}`);

  if (subError) {
    console.error(
      "[subscription-engine] Failed to fetch subscriptions for order placement:",
      subError,
    );
    return { ordersCreated: 0, skippedSubscriptions: 0, errors: [subError.message] };
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log("[subscription-engine] No subscriptions to process for order placement.");
    return { ordersCreated: 0, skippedSubscriptions: 0, errors: [] };
  }

  let ordersCreated = 0;
  let skippedSubscriptions = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    try {
      const customer = sub.customers as unknown as {
        id: string;
        email: string;
        name: string;
        push_token: string | null;
      };

      // Check for existing order with the same subscription + fulfillment date (idempotency)
      const idempotencyKey = `sub_${sub.id}_${fulfillmentDate}`;
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingOrder) {
        // The order was pre-created (subscribe / resume / edit) as Vorgemerkt.
        // It IS being placed for this week now, so send the "order placed"
        // email on schedule (the pre-create path deliberately stays silent).
        // The 22:00 lock charges it like any other pending order.
        console.log(
          `[subscription-engine] Order already exists for subscription ${sub.id} on ${fulfillmentDate}. Sending placed notification.`,
        );
        await dispatchNotification(
          customer.id,
          "order_placed",
          customer.push_token ? "both" : "email",
          { fulfillment_date: fulfillmentDate },
        );
        skippedSubscriptions++;
        continue;
      }

      // Fetch subscription items with product details
      const { data: items, error: itemsError } = await supabase
        .from("subscription_items")
        .select(`
          id,
          product_id,
          quantity,
          products!inner (
            id,
            name,
            price_cents,
            cycle,
            subscribable,
            ${pickupDayColumn}
          )
        `)
        .eq("subscription_id", sub.id);

      if (itemsError) {
        errors.push(
          `Subscription ${sub.id}: failed to fetch items — ${itemsError.message}`,
        );
        console.error(
          `[subscription-engine] Error fetching items for subscription ${sub.id}:`,
          itemsError,
        );
        continue;
      }

      if (!items || items.length === 0) {
        console.log(
          `[subscription-engine] Subscription ${sub.id} has no items. Skipping.`,
        );
        skippedSubscriptions++;
        continue;
      }

      // Filter items: only include products that are:
      // 1. Available on the pickup day (available_wed / available_sat)
      // 2. Match the current week cycle (permanent always, week_a only in A, week_b only in B)
      const validItems = items.filter((item) => {
        const product = item.products as unknown as {
          id: string;
          name: string;
          price_cents: number;
          cycle: string;
          [key: string]: unknown;
        };

        // Check pickup day availability
        const availableForDay = product[pickupDayColumn];
        if (!availableForDay) {
          console.log(
            `[subscription-engine] Product ${product.id} not available for ${pickupDayColumn}. Skipping.`,
          );
          return false;
        }

        // Seasonal/temporary products can't be part of a subscription
        if (product.subscribable === false) {
          return false;
        }

        // Check week cycle
        if (product.cycle === "hidden") {
          return false;
        }
        if (product.cycle === "week_a" && currentWeek !== "A") {
          return false;
        }
        if (product.cycle === "week_b" && currentWeek !== "B") {
          return false;
        }
        // 'permanent' is always included

        return true;
      });

      if (validItems.length === 0) {
        console.log(
          `[subscription-engine] Subscription ${sub.id}: no valid items for this week/day. Skipping.`,
        );
        skippedSubscriptions++;
        continue;
      }

      // Calculate total_cents
      const totalCents = validItems.reduce((sum, item) => {
        const product = item.products as unknown as { price_cents: number };
        return sum + product.price_cents * item.quantity;
      }, 0);

      // Create the order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          customer_id: customer.id,
          order_type: "subscription",
          subscription_id: sub.id,
          fulfillment_date: fulfillmentDate,
          pickup_location_id: sub.pickup_location_id,
          status: "scheduled",
          payment_status: "pending",
          total_cents: totalCents,
          customer_email: customer.email,
          customer_name: customer.name,
          idempotency_key: idempotencyKey,
        })
        .select("id")
        .single();

      if (orderError || !order) {
        errors.push(
          `Subscription ${sub.id}: failed to create order — ${orderError?.message ?? "unknown error"}`,
        );
        console.error(
          `[subscription-engine] Failed to create order for subscription ${sub.id}:`,
          orderError,
        );
        continue;
      }

      // Create order_items
      const orderItemsData = validItems.map((item) => {
        const product = item.products as unknown as {
          id: string;
          price_cents: number;
        };
        return {
          order_id: order.id,
          product_id: product.id,
          quantity: item.quantity,
          unit_price_cents: product.price_cents,
        };
      });

      const { error: orderItemsError } = await supabase
        .from("order_items")
        .insert(orderItemsData);

      if (orderItemsError) {
        // Rollback: delete the order if order_items failed
        await supabase.from("orders").delete().eq("id", order.id);
        errors.push(
          `Subscription ${sub.id}: failed to create order_items — ${orderItemsError.message}`,
        );
        console.error(
          `[subscription-engine] Failed to create order_items for order ${order.id}:`,
          orderItemsError,
        );
        continue;
      }

      // Send "order placed" notification (push/email + logging)
      await dispatchNotification(
        customer.id,
        "order_placed",
        customer.push_token ? "both" : "email",
        { fulfillment_date: fulfillmentDate },
      );

      // Audit log
      await logAudit(
        "subscription_order_placed",
        "order",
        order.id,
        null,
        {
          subscription_id: sub.id,
          fulfillment_date: fulfillmentDate,
          total_cents: totalCents,
          items_count: validItems.length,
        },
      );

      ordersCreated++;

      console.log(
        `[subscription-engine] Order ${order.id} created for subscription ${sub.id} (${fulfillmentDate}), total=${totalCents}¢`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Subscription ${sub.id}: ${msg}`);
      console.error(
        `[subscription-engine] Error processing order placement for subscription ${sub.id}:`,
        err,
      );
    }
  }

  console.log(
    `[subscription-engine] process8pmOrderPlacement done: ` +
      `${ordersCreated} orders created, ${skippedSubscriptions} skipped, ${errors.length} errors`,
  );
  return { ordersCreated, skippedSubscriptions, errors };
}

/**
 * 3. process_10pm_lock()
 *
 * Called at Monday/Thursday 22:00.
 * For all orders with status='grace_period_open':
 *   - Change status to 'locked_for_production'
 *   - Process payment via Stripe (create PaymentIntent, confirm)
 *   - Mark payment_status='paid' or 'failed'
 *   - If payment fails, set subscription status='payment_failed', notify admin
 */
async function process10pmLock(): Promise<{
  locked: number;
  paid: number;
  failed: number;
  errors: string[];
}> {
  console.log(
    "[subscription-engine] process10pmLock: locking grace_period_open orders",
  );

  // Find all orders in grace period
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id,
      customer_id,
      subscription_id,
      total_cents,
      order_type,
      customers!inner (
        id,
        email,
        name,
        push_token
      )
    `)
    // Charge the subscription orders whose cutoff is NOW — i.e. those for the
    // imminent pickup date. Orders may have been created early (at subscription
    // time) as 'scheduled', so we accept 'scheduled' or 'grace_period_open'
    // but only for this run's pickup date, never future ones.
    .in("status", ["scheduled", "grace_period_open"])
    .eq("order_type", "subscription")
    .eq("fulfillment_date", getNextFulfillmentDate());

  if (ordersError) {
    console.error(
      "[subscription-engine] Failed to fetch orders to lock:",
      ordersError,
    );
    return { locked: 0, paid: 0, failed: 0, errors: [ordersError.message] };
  }

  if (!orders || orders.length === 0) {
    console.log("[subscription-engine] No orders in grace period to lock.");
    return { locked: 0, paid: 0, failed: 0, errors: [] };
  }

  let locked = 0;
  let paid = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const order of orders) {
    try {
      const customer = order.customers as unknown as {
        id: string;
        email: string;
        name: string;
        push_token: string | null;
      };

      // Step 1: Lock the order for production (change status regardless of payment outcome)
      const { error: lockError } = await supabase
        .from("orders")
        .update({
          status: "locked_for_production",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .in("status", ["scheduled", "grace_period_open"]); // Conditional update for safety

      if (lockError) {
        errors.push(
          `Order ${order.id}: failed to lock — ${lockError.message}`,
        );
        console.error(
          `[subscription-engine] Failed to lock order ${order.id}:`,
          lockError,
        );
        continue;
      }

      locked++;

      // Step 2: Process Stripe payment
      try {
        // Get or create Stripe customer
        const stripeCustomer = await getOrCreateStripeCustomer(
          customer.id,
          customer.email,
          customer.name,
        );

        if (!stripeCustomer) {
          throw new Error("Could not create/find Stripe customer");
        }

        // Get default payment method
        const paymentMethod = await getDefaultPaymentMethod(stripeCustomer.id);

        if (!paymentMethod) {
          throw new Error(
            `No payment method found for customer ${stripeCustomer.id}`,
          );
        }

        // Create PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: order.total_cents,
            currency: "eur",
            customer: stripeCustomer.id,
            payment_method: paymentMethod.id,
            off_session: true,
            confirm: true,
            description: `Smittenbrot subscription order — ${order.id}`,
            metadata: {
              order_id: order.id,
              order_type: "subscription",
            },
          },
          {
            idempotencyKey: `sub_lock_${order.id}`,
          },
        );

        if (paymentIntent.status === "succeeded" ||
            paymentIntent.status === "processing") {
          // Payment succeeded or is processing
          const paymentStatus = paymentIntent.status === "succeeded"
            ? "paid"
            : "pending";

          const { error: updateError } = await supabase
            .from("orders")
            .update({
              payment_status: paymentStatus,
              stripe_payment_intent_id: paymentIntent.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          if (updateError) {
            errors.push(
              `Order ${order.id}: payment captured but failed to update status — ${updateError.message}`,
            );
            console.error(
              `[subscription-engine] Failed to update payment status for order ${order.id}:`,
              updateError,
            );
          } else {
            paid++;

            // ── Send receipt email ──
            try {
              const receiptUrl = `${SUPABASE_URL}/functions/v1/notification-dispatch`;
              // Call notification-dispatch via direct function import pattern
              // Since we can't import from other functions, build and send receipt here
              const customerEmail = customer.email;
              // Re-fetch the order so we get the invoice_number, order_number and
              // net/vat/total assigned by the numbering + tax triggers on the
              // paid transition (the in-loop `order` predates them).
              const { data: paidOrder } = await supabase
                .from("orders")
                .select("*")
                .eq("id", order.id)
                .single();
              const fullOrder = paidOrder ?? order;
              const invoiceNumber = (fullOrder.invoice_number as string) ||
                order.id.substring(0, 8).toUpperCase();
              const { data: receiptItems } = await supabase
                .from("order_items")
                .select("quantity, unit_price_cents, product:product_id(name)")
                .eq("order_id", order.id);
              const items = (receiptItems ?? []).map((it: Record<string, unknown>) => ({
                quantity: it.quantity as number,
                unit_price_cents: it.unit_price_cents as number,
                name: ((it.product as { name?: string } | null)?.name) ?? "Produkt",
              }));
              const fulfillmentDate = await getFulfillmentDateFromOrder(order.id);
              const { data: pickupLoc } = fullOrder.pickup_location_id
                ? await supabase.from("pickup_locations").select("pickup_instructions").eq("id", fullOrder.pickup_location_id as string).single()
                : { data: null };
              const pickupInstructions = (pickupLoc?.pickup_instructions as string) ||
                "Deine Bestellnummer steht auf der Verpackung deiner Bestellung.";

              const htmlReceipt = buildReceiptHtml(fullOrder, customer, items, invoiceNumber, fulfillmentDate, pickupInstructions);

              // Send via Brevo API directly
              const brevoPayload = {
                sender: { email: "info@smittenbrot.de", name: "Smittenbrot" },
                to: [{ email: customerEmail }],
                subject: `Deine Smittenbrot Bestellbestätigung ${(fullOrder.order_number as string) || invoiceNumber}`,
                htmlContent: htmlReceipt,
              };
              
              const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
              if (brevoKey) {
                const brevoResp = await fetch("https://api.brevo.com/v3/smtp/email", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "api-key": brevoKey,
                    "Accept": "application/json",
                  },
                  body: JSON.stringify(brevoPayload),
                });
                if (brevoResp.ok) {
                  console.log(`[subscription-engine] Receipt sent to ${customerEmail} for order ${order.id}`);
                  await logReceiptOutcome(customer.id, fullOrder, true);
                } else {
                  const body = await brevoResp.text();
                  console.warn(`[subscription-engine] Failed to send receipt: ${body}`);
                  await logReceiptOutcome(
                    customer.id,
                    fullOrder,
                    false,
                    `Brevo ${brevoResp.status}: ${body.slice(0, 300)}`,
                  );
                }
              } else {
                console.error("[subscription-engine] BREVO_API_KEY not configured — cannot send receipt.");
                await logReceiptOutcome(customer.id, fullOrder, false, "BREVO_API_KEY not configured");
              }
            } catch (receiptError) {
              const msg = receiptError instanceof Error ? receiptError.message : String(receiptError);
              console.warn(`[subscription-engine] Receipt sending error for order ${order.id}:`, receiptError);
              // `fullOrder` is scoped to the try block; `order` is always in scope
              // and logReceiptOutcome falls back to its id when there is no number.
              await logReceiptOutcome(customer.id, order as unknown as Record<string, unknown>, false, msg);
            }

            console.log(
              `[subscription-engine] Order ${order.id}: payment ${paymentStatus} (PI: ${paymentIntent.id})`,
            );
          }

          // Audit log for payment
          await logAudit(
            "subscription_payment_captured",
            "order",
            order.id,
            { payment_status: "pending", status: "grace_period_open" },
            {
              payment_status: paymentStatus,
              status: "locked_for_production",
              stripe_payment_intent_id: paymentIntent.id,
            },
          );
        } else {
          // Payment requires further action or failed
          const failureReason =
            paymentIntent.last_payment_error?.message ?? "Payment declined";

          throw new Error(
            `Payment not successful (${paymentIntent.status}): ${failureReason}`,
          );
        }
      } catch (paymentError) {
        // Payment failed — mark order and subscription
        const msg = paymentError instanceof Error
          ? paymentError.message
          : String(paymentError);

        console.error(
          `[subscription-engine] Payment failed for order ${order.id}: ${msg}`,
        );

        failed++;

        // Update order payment_status to 'failed'
        const { error: failUpdateError } = await supabase
          .from("orders")
          .update({
            payment_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        if (failUpdateError) {
          console.error(
            `[subscription-engine] Failed to mark order ${order.id} as payment_failed:`,
            failUpdateError,
          );
        }

        // If this is a subscription order, mark subscription as payment_failed
        if (order.subscription_id) {
          const { error: subFailError } = await supabase
            .from("subscriptions")
            .update({
              status: "payment_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.subscription_id);

          if (subFailError) {
            console.error(
              `[subscription-engine] Failed to mark subscription ${order.subscription_id} as payment_failed:`,
              subFailError,
            );
          }
        }

        // Send payment_failed notification to customer
        await dispatchNotification(customer.id, "payment_failed", "both");

        // Send admin alert about payment failure
        await dispatchNotification(null, "admin_alert", "both", {
          message:
            `Zahlung fehlgeschlagen für Bestellung ${order.id}` +
            `${customer.name ? ` (${customer.name})` : ""}: ${msg}`,
        });

        // Audit log
        await logAudit(
          "subscription_payment_failed",
          "order",
          order.id,
          { payment_status: "pending" },
          { payment_status: "failed", error: msg },
        );

        errors.push(`Order ${order.id}: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Order ${order.id}: ${msg}`);
      console.error(
        `[subscription-engine] Error processing lock for order ${order.id}:`,
        err,
      );
    }
  }

  console.log(
    `[subscription-engine] process10pmLock done: ` +
      `${locked} locked, ${paid} paid, ${failed} failed, ${errors.length} errors`,
  );
  return { locked, paid, failed, errors };
}

/**
 * 4. process_cancellations()
 *
 * Called at Monday/Thursday 22:00.
 * Subscriptions with status='cancellation_pending' get cancelled.
 */
async function processCancellations(): Promise<{
  cancelled: number;
  errors: string[];
}> {
  console.log("[subscription-engine] processCancellations: processing");

  // Find all cancellation_pending subscriptions
  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_id
    `)
    .eq("status", "cancellation_pending");

  if (subError) {
    console.error(
      "[subscription-engine] Failed to fetch cancellation_pending subscriptions:",
      subError,
    );
    return { cancelled: 0, errors: [subError.message] };
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log("[subscription-engine] No cancellation_pending subscriptions.");
    return { cancelled: 0, errors: [] };
  }

  let cancelled = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    try {
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id)
        .eq("status", "cancellation_pending"); // conditional update for safety

      if (updateError) {
        errors.push(
          `Subscription ${sub.id}: failed to cancel — ${updateError.message}`,
        );
        console.error(
          `[subscription-engine] Failed to cancel subscription ${sub.id}:`,
          updateError,
        );
        continue;
      }

      cancelled++;

      // Send cancellation notification to customer
      await dispatchNotification(sub.customer_id, "subscription_cancelled", "both");

      // Audit log
      await logAudit(
        "subscription_cancelled",
        "subscription",
        sub.id,
        { status: "cancellation_pending" },
        { status: "cancelled" },
      );

      console.log(
        `[subscription-engine] Subscription ${sub.id} cancelled.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Subscription ${sub.id}: ${msg}`);
      console.error(
        `[subscription-engine] Error cancelling subscription ${sub.id}:`,
        err,
      );
    }
  }

  console.log(
    `[subscription-engine] processCancellations done: ` +
      `${cancelled} cancelled, ${errors.length} errors`,
  );
  return { cancelled, errors };
}

/**
 * 5. process_single_subscription(subscription_id)
 *
 * Processes a single subscription's order for the next fulfillment date.
 * This is an on-demand function that creates an order for a specific
 * subscription, following the same logic as process8pmOrderPlacement
 * but for a single subscription.
 */
async function processSingleSubscription(
  subscriptionId: string,
  options?: {
    fulfillmentDate?: string;
    skipIfExisting?: boolean;
  },
): Promise<{
  orderId: string | null;
  success: boolean;
  error: string | null;
}> {
  const skipIfExisting = options?.skipIfExisting ?? true;

  // Fetch subscription (incl. its chosen pickup_day) first — the fulfillment
  // date depends on which weekday this subscription is for.
  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_id,
      pickup_day,
      pickup_location_id,
      status,
      paused_until,
      customers!inner (
        id,
        email,
        name,
        push_token
      )
    `)
    .eq("id", subscriptionId)
    .single();

  if (subError || !sub) {
    const msg = subError?.message ?? "Subscription not found";
    console.error(
      `[subscription-engine] Failed to fetch subscription ${subscriptionId}:`,
      subError,
    );
    return { orderId: null, success: false, error: msg };
  }

  const subPickupDay = (sub.pickup_day as "wednesday" | "saturday") ?? "wednesday";
  const fulfillmentDate = options?.fulfillmentDate ?? getNextDateForPickupDay(subPickupDay);
  const pickupDayColumn = subPickupDay === "wednesday" ? "available_wed" : "available_sat";
  const currentWeek = await getCurrentWeekType();

  console.log(
    `[subscription-engine] processSingleSubscription: ` +
      `sub=${subscriptionId}, fulfillmentDate=${fulfillmentDate}, week=${currentWeek}`,
  );

  const customer = sub.customers as unknown as {
    id: string;
    email: string;
    name: string;
    push_token: string | null;
  };

  // Check subscription status
  if (sub.status !== "active") {
    const msg = `Subscription ${subscriptionId} is not active (status=${sub.status})`;
    console.log(`[subscription-engine] ${msg}`);
    return { orderId: null, success: false, error: msg };
  }

  // Check if paused
  if (sub.paused_until) {
    const pausedUntil = new Date(sub.paused_until);
    const fulfillmentDateObj = new Date(fulfillmentDate);
    // Format both as YYYY-MM-DD for comparison
    const pausedDate = sub.paused_until;
    if (pausedDate >= fulfillmentDate) {
      const msg = `Subscription ${subscriptionId} is paused until ${pausedDate}`;
      console.log(`[subscription-engine] ${msg}`);
      return { orderId: null, success: false, error: msg };
    }
  }

  // Check idempotency
  const idempotencyKey = `sub_${sub.id}_${fulfillmentDate}`;
  if (skipIfExisting) {
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingOrder) {
      console.log(
        `[subscription-engine] Order already exists for subscription ${sub.id} on ${fulfillmentDate}.`,
      );
      return {
        orderId: existingOrder.id,
        success: true,
        error: null,
      };
    }
  }

  // Fetch subscription items with product details
  const { data: items, error: itemsError } = await supabase
    .from("subscription_items")
    .select(`
      id,
      product_id,
      quantity,
      products!inner (
        id,
        name,
        price_cents,
        cycle,
        subscribable,
        ${pickupDayColumn}
      )
    `)
    .eq("subscription_id", sub.id);

  if (itemsError) {
    const msg = `Failed to fetch items: ${itemsError.message}`;
    console.error(
      `[subscription-engine] ${msg} for subscription ${sub.id}:`,
      itemsError,
    );
    return { orderId: null, success: false, error: msg };
  }

  if (!items || items.length === 0) {
    const msg = `Subscription ${sub.id} has no items`;
    return { orderId: null, success: false, error: msg };
  }

  // Filter valid items (same logic as bulk placement)
  const validItems = items.filter((item) => {
    const product = item.products as unknown as {
      id: string;
      name: string;
      price_cents: number;
      cycle: string;
      [key: string]: unknown;
    };

    const availableForDay = product[pickupDayColumn];
    if (!availableForDay) return false;

    if (product.subscribable === false) return false;
    if (product.cycle === "hidden") return false;
    if (product.cycle === "week_a" && currentWeek !== "A") return false;
    if (product.cycle === "week_b" && currentWeek !== "B") return false;

    return true;
  });

  if (validItems.length === 0) {
    const msg = `No valid items for this fulfillment date`;
    return { orderId: null, success: false, error: msg };
  }

  // Calculate total
  const totalCents = validItems.reduce((sum, item) => {
    const product = item.products as unknown as { price_cents: number };
    return sum + product.price_cents * item.quantity;
  }, 0);

  // Create order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customer.id,
      order_type: "subscription",
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
      pickup_location_id: sub.pickup_location_id,
      status: "scheduled",
      payment_status: "pending",
      total_cents: totalCents,
      customer_email: customer.email,
      customer_name: customer.name,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    const msg = orderError?.message ?? "Failed to create order";
    console.error(
      `[subscription-engine] Failed to create order for subscription ${sub.id}:`,
      orderError,
    );
    return { orderId: null, success: false, error: msg };
  }

  // Create order_items
  const orderItemsData = validItems.map((item) => {
    const product = item.products as unknown as {
      id: string;
      price_cents: number;
    };
    return {
      order_id: order.id,
      product_id: product.id,
      quantity: item.quantity,
      unit_price_cents: product.price_cents,
    };
  });

  const { error: oiError } = await supabase
    .from("order_items")
    .insert(orderItemsData);

  if (oiError) {
    // Rollback order
    await supabase.from("orders").delete().eq("id", order.id);
    const msg = `Failed to create order_items: ${oiError.message}`;
    console.error(
      `[subscription-engine] ${msg} for order ${order.id}:`,
      oiError,
    );
    return { orderId: null, success: false, error: msg };
  }

  // NOTE: no "order placed" email here. This path just pre-creates the
  // Vorgemerkt (pending) order on subscribe / resume / edit. The customer is
  // told "order placed, change until 22h" only on the scheduled placement day
  // (process8pmOrderPlacement, Mon/Thu) — not immediately when they resume.

  // Audit log
  await logAudit(
    "subscription_order_prenoted",
    "order",
    order.id,
    null,
    {
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
      total_cents: totalCents,
      items_count: validItems.length,
    },
  );

  console.log(
    `[subscription-engine] Single order ${order.id} created for subscription ${sub.id}`,
  );

  return {
    orderId: order.id,
    success: true,
    error: null,
  };
}

/**
 * Pause a subscription: set it paused (with an optional resume date) AND
 * remove any already-generated, NOT-yet-charged upcoming order, so the customer
 * is not charged for the paused week and the capacity is freed. An order that
 * is already charged/locked (past its cutoff) is left untouched — that week
 * stands and the pause takes effect from the next delivery.
 */
async function pauseSubscription(
  subscriptionId: string,
  resumeDate: string | null,
): Promise<{ success: boolean; removedOrders: number; error: string | null }> {
  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      status: "paused",
      paused_until: resumeDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);
  if (subErr) return { success: false, removedOrders: 0, error: subErr.message };

  const today = todayInTz();
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("order_type", "subscription")
    .in("status", ["scheduled", "grace_period_open"])
    .eq("payment_status", "pending")
    .gte("fulfillment_date", today);

  let removed = 0;
  for (const o of orders ?? []) {
    await supabase.from("order_items").delete().eq("order_id", o.id);
    const { error: delErr } = await supabase.from("orders").delete().eq("id", o.id);
    if (!delErr) removed++;
  }

  await logAudit("subscription_paused", "subscription", subscriptionId, null, {
    paused_until: resumeDate,
    removed_orders: removed,
  });
  return { success: true, removedOrders: removed, error: null };
}

/**
 * Resume a paused subscription and regenerate the upcoming order (if still
 * before its cutoff). Idempotent — if an order already exists it is kept.
 */
async function resumeSubscription(
  subscriptionId: string,
): Promise<{ success: boolean; orderId: string | null; error: string | null }> {
  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      paused_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);
  if (subErr) return { success: false, orderId: null, error: subErr.message };

  const result = await processSingleSubscription(subscriptionId);
  await logAudit("subscription_resumed", "subscription", subscriptionId, null, {
    order_id: result.orderId,
  });
  return { success: true, orderId: result.orderId, error: null };
}

/**
 * Customer-facing: modify an active/paused subscription's items (and optionally
 * its pickup location). Ownership is verified against the caller's user id.
 *
 * Reuses processSingleSubscription so the not-yet-charged upcoming order is
 * rebuilt from the new items — the change lands on this week's single charge
 * when that order isn't locked yet, otherwise it applies from the next
 * delivery (no refund/recharge, no second transaction).
 */
async function updateSubscription(
  userId: string,
  subscriptionId: string,
  items: { product_id: string; quantity: number }[],
  pickupLocationId: string | null,
): Promise<{ success: boolean; applied_this_week: boolean; error: string | null }> {
  // 1. Ownership + editable status
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, customer_id, status, pickup_day, pickup_location_id")
    .eq("id", subscriptionId)
    .single();
  if (subErr || !sub) return { success: false, applied_this_week: false, error: "Subscription not found" };
  if (sub.customer_id !== userId) return { success: false, applied_this_week: false, error: "Not your subscription" };
  if (sub.status !== "active" && sub.status !== "paused") {
    return { success: false, applied_this_week: false, error: `Cannot edit a ${sub.status} subscription` };
  }

  // 2. Validate items (server-side — never trust client prices/products)
  const clean = (items ?? [])
    .filter((i) => i && i.product_id && Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => ({ product_id: i.product_id, quantity: Math.min(99, Math.floor(i.quantity)) }));
  if (clean.length === 0) return { success: false, applied_this_week: false, error: "At least one item is required" };
  const { data: prods } = await supabase.from("products").select("id, subscribable").in("id", clean.map((i) => i.product_id));
  const okIds = new Set((prods ?? []).filter((p) => p.subscribable !== false).map((p) => p.id));
  if (clean.some((i) => !okIds.has(i.product_id))) {
    return { success: false, applied_this_week: false, error: "Product not available for subscription" };
  }

  // 3. Optional pickup-location change
  let locId = sub.pickup_location_id;
  if (pickupLocationId && pickupLocationId !== sub.pickup_location_id) {
    const { data: loc } = await supabase
      .from("pickup_locations").select("id").eq("id", pickupLocationId).eq("active", true).maybeSingle();
    if (!loc) return { success: false, applied_this_week: false, error: "Invalid pickup location" };
    locId = pickupLocationId;
    await supabase.from("subscriptions")
      .update({ pickup_location_id: locId, updated_at: new Date().toISOString() }).eq("id", sub.id);
  }

  // 4. Replace the subscription's items
  await supabase.from("subscription_items").delete().eq("subscription_id", sub.id);
  const { error: insErr } = await supabase.from("subscription_items")
    .insert(clean.map((i) => ({ subscription_id: sub.id, product_id: i.product_id, quantity: i.quantity })));
  if (insErr) return { success: false, applied_this_week: false, error: insErr.message };

  // 5. Rebuild the upcoming order (active subs only; paused subs get a fresh
  //    order when they resume).
  let appliedThisWeek = false;
  if (sub.status === "active") {
    const nextDate = getNextDateForPickupDay((sub.pickup_day as "wednesday" | "saturday") ?? "wednesday");
    const { data: existing } = await supabase
      .from("orders")
      .select("id, payment_status, status")
      .eq("subscription_id", sub.id)
      .eq("fulfillment_date", nextDate)
      .maybeSingle();

    if (existing) {
      const charged = existing.payment_status === "paid" ||
        existing.status === "locked_for_production" || existing.status === "fulfilled";
      if (!charged) {
        // Not yet charged → replace it with a fresh order from the new items.
        await supabase.from("order_items").delete().eq("order_id", existing.id);
        await supabase.from("orders").delete().eq("id", existing.id);
        const r = await processSingleSubscription(sub.id, { skipIfExisting: false });
        appliedThisWeek = r.success;
      }
      // charged/locked → leave it untouched; change applies from next delivery.
    } else {
      const r = await processSingleSubscription(sub.id, { skipIfExisting: true });
      appliedThisWeek = r.success;
    }
  }

  return { success: true, applied_this_week: appliedThisWeek, error: null };
}

// ── HTTP Router ──────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  // Allow invocation via path (e.g., /process-12pm-reminders) or
  // via query parameter (e.g., ?action=process-12pm-reminders) for
  // compatibility with different cron trigger setups.
  const actionParam = url.searchParams.get("action");
  const action = actionParam ?? path.split("/").pop() ?? "";

  // ── DST guard for the time-sensitive cron actions ──
  // Each is cron-scheduled at both the summer and winter UTC hours; only the
  // firing that lands on the intended Berlin-local hour proceeds, the other is
  // a no-op. `?force=1` bypasses the guard for manual/testing invocation.
  const GUARDED_HOURS: Record<string, number> = {
    "process-12pm-reminders": 12,
    "process_12pm_reminders": 12,
    "process-8pm-order-placement": 20,
    "process_8pm_order_placement": 20,
    "process-10pm-lock": 22,
    "process_10pm_lock": 22,
  };
  const expectedHour = GUARDED_HOURS[action];
  if (expectedHour !== undefined && url.searchParams.get("force") !== "1") {
    const h = berlinHour();
    if (h !== expectedHour) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: `DST guard: Berlin hour ${h} != expected ${expectedHour}. No-op firing of the dual UTC schedule.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  try {
    switch (action) {
      case "process-12pm-reminders":
      case "process_12pm_reminders": {
        const result = await process12pmReminders();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "process-8pm-order-placement":
      case "process_8pm_order_placement": {
        const result = await process8pmOrderPlacement();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "process-10pm-lock":
      case "process_10pm_lock": {
        const result = await process10pmLock();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "process-cancellations":
      case "process_cancellations": {
        const result = await processCancellations();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "process-single-subscription":
      case "process_single_subscription": {
        let body: { subscription_id?: string; fulfillment_date?: string; skip_if_existing?: boolean };
        try {
          body = await req.json();
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid JSON body" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (!body.subscription_id) {
          return new Response(
            JSON.stringify({ error: "subscription_id is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const result = await processSingleSubscription(body.subscription_id, {
          fulfillmentDate: body.fulfillment_date,
          skipIfExisting: body.skip_if_existing ?? true,
        });

        const statusCode = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "pause":
      case "pause-subscription": {
        let body: { subscription_id?: string; resume_date?: string };
        try { body = await req.json(); } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (!body.subscription_id) {
          return new Response(JSON.stringify({ error: "subscription_id is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const result = await pauseSubscription(body.subscription_id, body.resume_date ?? null);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { "Content-Type": "application/json" } });
      }

      case "resume":
      case "resume-subscription": {
        let body: { subscription_id?: string };
        try { body = await req.json(); } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (!body.subscription_id) {
          return new Response(JSON.stringify({ error: "subscription_id is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const result = await resumeSubscription(body.subscription_id);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { "Content-Type": "application/json" } });
      }

      case "update-subscription": {
        // Customer-facing: this fn is --no-verify-jwt (for cron), so verify the
        // caller's JWT + subscription ownership manually.
        const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        let body: { subscription_id?: string; items?: { product_id: string; quantity: number }[]; pickup_location_id?: string | null };
        try { body = await req.json(); } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (!body.subscription_id || !Array.isArray(body.items)) {
          return new Response(JSON.stringify({ error: "subscription_id and items are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const result = await updateSubscription(user.id, body.subscription_id, body.items, body.pickup_location_id ?? null);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { "Content-Type": "application/json" } });
      }

      default: {
        // If no recognized action, return available endpoints
        return new Response(
          JSON.stringify({
            error: "Unknown action",
            available_actions: [
              "process-12pm-reminders",
              "process-8pm-order-placement",
              "process-10pm-lock",
              "process-cancellations",
              "process-single-subscription",
              "pause",
              "resume",
            ],
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[subscription-engine] Unhandled error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
