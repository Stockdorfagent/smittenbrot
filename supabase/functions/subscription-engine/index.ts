// ============================================================
// Smittenbrot — Subscription Engine Edge Function
// ============================================================
// Processes the weekly subscription schedule:
//   - Monday/Thursday 12:00: Send subscription reminders
//   - Monday/Thursday 20:00: Place subscription orders = charge the saved
//                            card; an order exists only once it is paid
//   - Monday/Thursday 22:00: Bestellschluss — lock paid orders for production
//   - Monday/Thursday 22:00: Process cancellations
//
// Time zone: Europe/Berlin
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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Shared secret the pg_net cron jobs send as Bearer (migration 024). Also in
// Postgres Vault under 'cron_secret' and in .credentials/cron-secret.txt.
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

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

/** JSON Response shorthand — same helper the sibling edge functions have. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
/**
 * For a "both" Abo, the next order is simply whichever of the two days comes
 * first with its cutoff still open. The Mon/Thu crons then keep generating one
 * order per day from there on.
 */
function getNextDateForSubscription(
  pickupDay: "wednesday" | "saturday" | "both",
): string {
  if (pickupDay !== "both") return getNextDateForPickupDay(pickupDay);
  const wed = getNextDateForPickupDay("wednesday");
  const sat = getNextDateForPickupDay("saturday");
  return wed <= sat ? wed : sat;
}

/** Which product-availability column applies to a concrete date. */
function availabilityColumnForDate(dateStr: string): "available_wed" | "available_sat" {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return dow === 6 ? "available_sat" : "available_wed";
}

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
  pickupName: string,
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
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 14px;">${eur(it.unit_price_cents * it.quantity)}</td>
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
        <tr><td style="padding: 2px 0; color: #6B7280;">Abholort:</td><td style="padding: 2px 0; text-align: right;">${pickupName}</td></tr>
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
          <tr><td style="padding: 6px 0 2px; font-size: 14px; color: #6B7280;">Nettobetrag</td><td style="padding: 6px 0 2px; text-align: right; font-size: 14px; color: #6B7280;">${eur(netCents)}</td></tr>
          <tr><td style="padding: 2px 0; font-size: 14px; color: #6B7280;">MwSt. (7 %)</td><td style="padding: 2px 0; text-align: right; font-size: 14px; color: #6B7280;">${eur(vatCents)}</td></tr>
          <tr><td style="padding: 10px 0 4px; font-size: 14px;"><strong>Gesamtsumme</strong></td><td style="padding: 10px 0 4px; text-align: right; font-size: 16px; font-weight: bold; color: #f8120e;">${eur(totalCents)}</td></tr>
        </tfoot>
      </table>

      <div style="background: #F3F4F6; border-radius: 8px; padding: 15px; margin: 20px 0; font-size: 13px; color: #1A1A1A;">
        <p style="margin: 0 0 8px;"><strong>Abholinformation</strong></p>
        <p style="margin: 0;">Deine Bestellung ist ab dem <strong>${formatIsoDe(fulfillmentDate)}</strong> abholbereit.<br>${pickupInstructions}</p>
      </div>

      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #6B7280; text-align: center;">
        Smittenbrot · Sauerteig aus Stockdorf · info@smittenbrot.de
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
 * `notifications` (delivered=true/false, reason on failure), linked to the
 * order via order_id (migration 023).
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
    order_id: (order.id as string | null) ?? null,
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
          category: (data?.category as string) ?? "other",
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
 * Returns the first attached card, or null.
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

    // Cards only: they settle synchronously, so "charged" is known at 20:00.
    // (sepa_debit is not enabled on the live account anyway.)
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
    // A "both" Abo runs on Wednesday AND Saturday, so it belongs to both runs.
    .in("pickup_day", [dow === 1 ? "wednesday" : "saturday", "both"])
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
          subscription_id: sub.id,
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
 * 1b. processOrderReminders()  — Bestell-Erinnerung per E-Mail (website-only feature, 20.09.2026)
 *
 * Called Monday/Thursday 12:00 Berlin (crons order-reminder-mon/-thu, migration 030).
 * For customers who opted in on /profile (customers.reminder_wednesday / reminder_saturday)
 * and do NOT have a Dauerbestellung for that pickup day, send ONE e-mail: "today until
 * 22:00 you can still order for <pickup date>". Skipped when the customer already has an
 * order for that date, when the bake day is closed, or when they run an active Abo for
 * that day (those get the Abo reminder at the same time). E-mail only, never push: the
 * app has its own local reminders (mobile/src/lib/reminder.ts) — owner's decision.
 *
 * `dayOverride` ('wednesday' | 'saturday') is for forced manual/test runs on other weekdays.
 */
async function processOrderReminders(dayOverride?: string): Promise<{
  processed: number;
  skipped: { subscribers: number; alreadyOrdered: number; noEmail: number };
  fulfillmentDate: string | null;
  errors: string[];
}> {
  const dow = currentDayOfWeek();
  const day = dayOverride === "wednesday" || dayOverride === "saturday"
    ? dayOverride
    : dow === 1 ? "wednesday" : dow === 4 ? "saturday" : null;
  const none = { subscribers: 0, alreadyOrdered: 0, noEmail: 0 };
  if (!day) {
    console.log(`[subscription-engine] processOrderReminders: not an order day (dow=${dow}), nothing to do.`);
    return { processed: 0, skipped: none, fulfillmentDate: null, errors: [] };
  }
  const flagColumn = day === "wednesday" ? "reminder_wednesday" : "reminder_saturday";
  const fulfillmentDate = dayOverride
    ? getNextDateForPickupDay(day as "wednesday" | "saturday")
    : getNextFulfillmentDate();

  // Closed bake day → no reminder (there is nothing to order for).
  const { data: closure } = await supabase
    .from("closures")
    .select("id")
    .lte("start_date", fulfillmentDate)
    .gte("end_date", fulfillmentDate)
    .limit(1)
    .maybeSingle();
  if (closure) {
    console.log(`[subscription-engine] processOrderReminders: ${fulfillmentDate} is a closure day, skipping.`);
    return { processed: 0, skipped: none, fulfillmentDate, errors: [] };
  }

  const { data: customers, error: custErr } = await supabase
    .from("customers")
    .select("id, email, name, unsubscribe_token")
    .eq(flagColumn, true);
  if (custErr) return { processed: 0, skipped: none, fulfillmentDate, errors: [custErr.message] };
  if (!customers || customers.length === 0) {
    console.log("[subscription-engine] processOrderReminders: nobody opted in.");
    return { processed: 0, skipped: none, fulfillmentDate, errors: [] };
  }
  const ids = customers.map((c) => c.id as string);

  // Who has an Abo running for this day (they get the 12:00 Abo reminder instead)?
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("customer_id")
    .in("customer_id", ids)
    .eq("status", "active")
    .in("pickup_day", [day, "both"])
    .or(`paused_until.is.null,paused_until.lt.${todayInTz()}`);
  const subscriberIds = new Set((subs ?? []).map((r) => r.customer_id as string));

  // Who already ordered for that pickup date?
  const { data: orders } = await supabase
    .from("orders")
    .select("customer_id")
    .in("customer_id", ids)
    .eq("fulfillment_date", fulfillmentDate)
    .not("status", "in", "(cancelled,refunded)");
  const orderedIds = new Set((orders ?? []).map((r) => r.customer_id as string));

  const skipped = { ...none };
  const errors: string[] = [];
  let processed = 0;
  for (const c of customers) {
    const id = c.id as string;
    if (subscriberIds.has(id)) { skipped.subscribers++; continue; }
    if (orderedIds.has(id)) { skipped.alreadyOrdered++; continue; }
    const email = (c.email as string | null) ?? "";
    if (!email.trim()) { skipped.noEmail++; continue; }
    try {
      await dispatchNotification(id, "order_reminder", "email", {
        fulfillment_date: fulfillmentDate,
        pickup_day: day,
        customer_id: id,
        unsubscribe_token: c.unsubscribe_token,
        name: c.name,
      });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Customer ${id}: ${msg}`);
    }
  }
  console.log(
    `[subscription-engine] processOrderReminders(${day}, ${fulfillmentDate}): ${processed} sent, ` +
      `skipped ${JSON.stringify(skipped)}, ${errors.length} errors`,
  );
  return { processed, skipped, fulfillmentDate, errors };
}

/**
 * This week's basket of ONE subscription, reduced to what is actually baked
 * for `fulfillmentDate`: available on that weekday, matching the A/B cycle,
 * subscribable and still active. Shared by the 20:00 placement, the noon
 * reminder's "Diese Woche dabei" and the client preview so all three agree.
 */
type DraftItem = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
};

async function buildSubscriptionDraft(
  subscriptionId: string,
  fulfillmentDate: string,
  currentWeek: "A" | "B",
): Promise<{ items: DraftItem[]; totalCents: number; error: string | null }> {
  const pickupDayColumn = availabilityColumnForDate(fulfillmentDate);
  const { data: rows, error } = await supabase
    .from("subscription_items")
    .select(`
      quantity,
      products!inner (
        id,
        name,
        price_cents,
        cycle,
        subscribable,
        active,
        ${pickupDayColumn}
      )
    `)
    .eq("subscription_id", subscriptionId);
  if (error) return { items: [], totalCents: 0, error: error.message };

  const items: DraftItem[] = [];
  for (const row of rows ?? []) {
    const p = row.products as unknown as {
      id: string;
      name: string;
      price_cents: number;
      cycle: string;
      subscribable: boolean;
      active: boolean;
      [key: string]: unknown;
    };
    if (!p[pickupDayColumn]) continue;
    if (p.subscribable === false) continue;
    if (p.active === false) continue;
    if (p.cycle === "hidden") continue;
    if (p.cycle === "week_a" && currentWeek !== "A") continue;
    if (p.cycle === "week_b" && currentWeek !== "B") continue;
    items.push({
      product_id: p.id,
      name: p.name,
      quantity: row.quantity as number,
      unit_price_cents: p.price_cents,
    });
  }
  const totalCents = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
  return { items, totalCents, error: null };
}

/**
 * Bestellbestätigung for a PAID order — the same e-mail a one-time checkout
 * produces. Re-reads the order so the number/invoice/net/VAT assigned by the
 * triggers on the paid transition are what the customer sees.
 */
async function sendOrderReceipt(
  orderId: string,
  customer: { id: string; email: string; name: string },
): Promise<void> {
  const { data: paidOrder } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (!paidOrder) {
    await logReceiptOutcome(customer.id, { id: orderId }, false, "order not found for receipt");
    return;
  }
  try {
    const invoiceNumber = (paidOrder.invoice_number as string) ||
      orderId.substring(0, 8).toUpperCase();
    const { data: receiptItems } = await supabase
      .from("order_items")
      .select("quantity, unit_price_cents, product:product_id(name)")
      .eq("order_id", orderId);
    const items = (receiptItems ?? []).map((it: Record<string, unknown>) => ({
      quantity: it.quantity as number,
      unit_price_cents: it.unit_price_cents as number,
      name: ((it.product as { name?: string } | null)?.name) ?? "Produkt",
    }));
    const fulfillmentDate = paidOrder.fulfillment_date as string;
    const { data: pickupLoc } = paidOrder.pickup_location_id
      ? await supabase.from("pickup_locations").select("name, address, pickup_instructions").eq("id", paidOrder.pickup_location_id as string).single()
      : { data: null };
    const pickupInstructions = (pickupLoc?.pickup_instructions as string) ||
      "Deine Bestellnummer steht auf der Verpackung deiner Bestellung.";
    const pickupName = pickupLoc ? `${pickupLoc.name} (${pickupLoc.address})` : "Abholort";

    const html = buildReceiptHtml(paidOrder, customer, items, invoiceNumber, fulfillmentDate, pickupInstructions, pickupName);
    const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
    if (!brevoKey) {
      console.error("[subscription-engine] BREVO_API_KEY not configured — cannot send receipt.");
      await logReceiptOutcome(customer.id, paidOrder, false, "BREVO_API_KEY not configured");
      return;
    }
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoKey,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: "info@smittenbrot.de", name: "Smittenbrot" },
        to: [{ email: customer.email }],
        subject: `Deine Smittenbrot Bestellbestätigung ${(paidOrder.order_number as string) || invoiceNumber}`,
        htmlContent: html,
      }),
    });
    if (resp.ok) {
      console.log(`[subscription-engine] Receipt sent to ${customer.email} for order ${orderId}`);
      await logReceiptOutcome(customer.id, paidOrder, true);
    } else {
      const body = await resp.text();
      console.warn(`[subscription-engine] Failed to send receipt: ${body}`);
      await logReceiptOutcome(customer.id, paidOrder, false, `Brevo ${resp.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[subscription-engine] Receipt sending error for order ${orderId}:`, err);
    await logReceiptOutcome(customer.id, paidOrder, false, msg);
  }
}

/** Mirror of stripe-webhook's paymentMethodOf: "card", "card/apple_pay", … */
async function paymentMethodLabel(pi: Stripe.PaymentIntent): Promise<string | null> {
  try {
    const lc = pi.latest_charge;
    if (!lc) return null;
    const charge = typeof lc === "string" ? await stripe.charges.retrieve(lc) : lc;
    const pmd = charge.payment_method_details;
    if (!pmd?.type) return null;
    const wallet = pmd.type === "card" ? pmd.card?.wallet?.type : undefined;
    return wallet ? `${pmd.type}/${wallet}` : pmd.type;
  } catch {
    return null;
  }
}

/**
 * Charge a subscription's saved card off-session. Returns the PaymentIntent
 * on success, otherwise the reason — a declined card throws a StripeCardError
 * which is caught here, so callers only ever branch on `ok`.
 *
 * Only `succeeded` counts. Cards settle synchronously; anything else
 * (requires_action, processing, …) is NOT a payment and must not become an
 * order.
 */
async function chargeSubscriptionAmount(
  customer: { id: string; email: string; name: string; stripe_customer_id?: string | null },
  amountCents: number,
  idempotencyKey: string,
  metadata: Record<string, string>,
): Promise<{ ok: true; pi: Stripe.PaymentIntent } | { ok: false; reason: string; piId: string | null }> {
  let stripeCustomer: Stripe.Customer | null = null;
  if (customer.stripe_customer_id) {
    try {
      const c = await stripe.customers.retrieve(customer.stripe_customer_id);
      if (!("deleted" in c && c.deleted)) stripeCustomer = c as Stripe.Customer;
    } catch { /* fall through to the e-mail lookup */ }
  }
  if (!stripeCustomer) {
    stripeCustomer = await getOrCreateStripeCustomer(customer.id, customer.email, customer.name);
  }
  if (!stripeCustomer) {
    return { ok: false, reason: "Stripe-Kunde konnte nicht ermittelt werden", piId: null };
  }
  const paymentMethod = await getDefaultPaymentMethod(stripeCustomer.id);
  if (!paymentMethod) {
    return { ok: false, reason: "Keine gespeicherte Zahlungsmethode", piId: null };
  }

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "eur",
        customer: stripeCustomer.id,
        payment_method: paymentMethod.id,
        off_session: true,
        confirm: true,
        description: `Smittenbrot Dauerbestellung — Abholung ${metadata.fulfillment_date ?? ""}`.trim(),
        metadata,
      },
      { idempotencyKey },
    );
    if (pi.status === "succeeded") return { ok: true, pi };
    const reason = pi.last_payment_error?.message ?? `Zahlung nicht abgeschlossen (${pi.status})`;
    return { ok: false, reason, piId: pi.id };
  } catch (err) {
    // Stripe surfaces a decline as an exception carrying the failed PI.
    const e = err as { message?: string; raw?: { payment_intent?: { id?: string } }; payment_intent?: { id?: string } };
    const piId = e.payment_intent?.id ?? e.raw?.payment_intent?.id ?? null;
    return { ok: false, reason: e.message ?? String(err), piId };
  }
}

/**
 * Place ONE subscription order for `fulfillmentDate` — and pay for it in the
 * same breath. Owner's rule (05.10.2026): placing an order IS paying for it.
 * There is no order without a successful payment, nothing is pre-booked or
 * reserved, and once placed the row is an ordinary paid order like any
 * single order: it gets the Bestellbestätigung, nothing more, nothing less.
 *
 *   1. subscription must be active and not paused for that date
 *   2. idempotency: one order per subscription and pickup date
 *   3. this week's basket (day availability, A/B cycle, subscribable, active)
 *   4. charge the saved card (cards only, `succeeded` only)
 *   5. ONLY THEN insert the order as paid (number + invoice via trigger) and
 *      send the Bestellbestätigung
 *   6. a declined charge → NO order; subscription → payment_failed; customer
 *      and admin are told
 *
 * Used by the Monday/Thursday 20:00 batch and by placeNowIfRunPassed (an Abo
 * created or resumed after 20:00 but before the 22:00 cutoff). `dryRun`
 * reports what would happen without charging, writing or notifying.
 */
type PlaceResult =
  | { outcome: "placed"; orderId: string; totalCents: number; items: DraftItem[] }
  | { outcome: "skipped"; reason: "not_active" | "paused" | "already_placed" | "no_items"; orderId: string | null }
  | { outcome: "would_place"; totalCents: number; items: DraftItem[] }
  | { outcome: "payment_failed"; reason: string }
  | { outcome: "error"; error: string };

async function placeAndChargeSubscriptionOrder(
  subscriptionId: string,
  fulfillmentDate: string,
  currentWeek: "A" | "B",
  dryRun = false,
): Promise<PlaceResult> {
  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      status,
      paused_until,
      pickup_location_id,
      customers!inner (
        id,
        email,
        name,
        stripe_customer_id
      )
    `)
    .eq("id", subscriptionId)
    .single();
  if (subError || !sub) return { outcome: "error", error: subError?.message ?? "Subscription not found" };
  if (sub.status !== "active") return { outcome: "skipped", reason: "not_active", orderId: null };
  if (sub.paused_until && (sub.paused_until as string) >= fulfillmentDate) {
    return { outcome: "skipped", reason: "paused", orderId: null };
  }
  const customer = sub.customers as unknown as {
    id: string;
    email: string;
    name: string;
    stripe_customer_id: string | null;
  };

  // ── Idempotency: one order per subscription and pickup date ──
  const idempotencyKey = `sub_${sub.id}_${fulfillmentDate}`;
  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, payment_status, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingOrder) {
    if (existingOrder.payment_status === "paid" ||
        existingOrder.status === "cancelled" || existingOrder.status === "refunded" ||
        existingOrder.status === "locked_for_production" || existingOrder.status === "fulfilled") {
      // Placed and paid already (a re-run), or placed and then cancelled by
      // the customer — either way this pickup is settled.
      return { outcome: "skipped", reason: "already_placed", orderId: existingOrder.id };
    }
    // An UNPAID leftover from the retired pre-booking flow. Not an order in
    // the owner's sense; drop it and place properly below.
    if (!dryRun) {
      await supabase.from("order_items").delete().eq("order_id", existingOrder.id);
      await supabase.from("orders").delete().eq("id", existingOrder.id);
      console.log(`[subscription-engine] Removed unpaid leftover order ${existingOrder.id} for subscription ${sub.id}.`);
    }
  }

  // ── This week's basket ──
  const draft = await buildSubscriptionDraft(sub.id, fulfillmentDate, currentWeek);
  if (draft.error) return { outcome: "error", error: `failed to fetch items — ${draft.error}` };
  if (draft.items.length === 0) return { outcome: "skipped", reason: "no_items", orderId: null };
  if (dryRun) return { outcome: "would_place", totalCents: draft.totalCents, items: draft.items };

  // ── Charge FIRST. The order id is fixed up front and travels in the
  //    PaymentIntent metadata, so a charge can always be traced back to the
  //    order it paid for even if the insert below should fail. ──
  const orderId = crypto.randomUUID();
  const charge = await chargeSubscriptionAmount(
    customer,
    draft.totalCents,
    `sub_place_${sub.id}_${fulfillmentDate}`,
    {
      order_id: orderId,
      order_type: "subscription",
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
      idempotency_key: idempotencyKey,
    },
  );

  if (!charge.ok) {
    // No payment → no order. The subscription stops until the customer saves
    // a working card and resumes it.
    console.error(`[subscription-engine] Payment failed for subscription ${sub.id}: ${charge.reason}`);
    const { error: subFailError } = await supabase
      .from("subscriptions")
      .update({ status: "payment_failed", updated_at: new Date().toISOString() })
      .eq("id", sub.id);
    if (subFailError) {
      console.error(`[subscription-engine] Failed to mark subscription ${sub.id} as payment_failed:`, subFailError);
    }
    await dispatchNotification(customer.id, "payment_failed", "both", {
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
    });
    await dispatchNotification(null, "admin_alert", "both", {
      category: "payment_failed",
      message:
        `Abo-Zahlung fehlgeschlagen${customer.name ? ` (${customer.name})` : ""}` +
        ` für ${fulfillmentDate}, ${eur(draft.totalCents)}: ${charge.reason}. Keine Bestellung angelegt.`,
    });
    await logAudit("subscription_payment_failed", "subscription", sub.id, { status: "active" }, {
      status: "payment_failed",
      fulfillment_date: fulfillmentDate,
      total_cents: draft.totalCents,
      error: charge.reason,
      stripe_payment_intent_id: charge.piId,
    });
    return { outcome: "payment_failed", reason: charge.reason };
  }

  // ── Paid. Now, and only now, the order exists. ──
  // Inserted as pending and flipped to paid in a second write so the
  // numbering trigger (BEFORE UPDATE, migration 007) assigns order_number +
  // invoice_number exactly as for a checkout order. The PaymentIntent id is
  // set in that same flip, so the stripe-webhook cannot find a half-written
  // order under this PI.
  const insertOrder = () =>
    supabase.from("orders").insert({
      id: orderId,
      customer_id: customer.id,
      order_type: "subscription",
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
      pickup_location_id: sub.pickup_location_id,
      status: "scheduled",
      payment_status: "pending",
      total_cents: draft.totalCents,
      customer_email: customer.email,
      customer_name: customer.name,
      idempotency_key: idempotencyKey,
    });
  let { error: orderError } = await insertOrder();
  if (orderError) ({ error: orderError } = await insertOrder());

  let itemsError: { message: string } | null = null;
  if (!orderError) {
    const r = await supabase.from("order_items").insert(
      draft.items.map((i) => ({
        order_id: orderId,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
      })),
    );
    itemsError = r.error;
  }

  let paidError: { message: string } | null = null;
  if (!orderError && !itemsError) {
    const r = await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        stripe_payment_intent_id: charge.pi.id,
        payment_method: await paymentMethodLabel(charge.pi),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    paidError = r.error;
  }

  if (orderError || itemsError || paidError) {
    // Money has moved but the order could not be written. Never silent: the
    // owner must reconcile this one by hand (PI id in the alert).
    const msg = orderError?.message ?? itemsError?.message ?? paidError?.message ?? "unknown";
    console.error(`[subscription-engine] CRITICAL: charge ${charge.pi.id} succeeded but order ${orderId} could not be saved: ${msg}`);
    await dispatchNotification(null, "admin_alert", "both", {
      category: "payment_failed",
      message:
        `KRITISCH: Abo-Zahlung ${charge.pi.id} (${eur(draft.totalCents)}${customer.name ? `, ${customer.name}` : ""}) ` +
        `ist eingegangen, aber die Bestellung ${orderId} für ${fulfillmentDate} konnte nicht gespeichert werden: ${msg}. Bitte in Stripe/Supabase prüfen.`,
    });
    await logAudit("subscription_order_write_failed", "order", orderId, null, {
      subscription_id: sub.id,
      fulfillment_date: fulfillmentDate,
      total_cents: draft.totalCents,
      stripe_payment_intent_id: charge.pi.id,
      error: msg,
    });
    return { outcome: "error", error: `charged (${charge.pi.id}) but order not saved — ${msg}` };
  }

  // Exactly what a single order gets: the Bestellbestätigung by e-mail.
  await sendOrderReceipt(orderId, customer);

  await logAudit("subscription_order_placed", "order", orderId, null, {
    subscription_id: sub.id,
    fulfillment_date: fulfillmentDate,
    total_cents: draft.totalCents,
    items_count: draft.items.length,
    stripe_payment_intent_id: charge.pi.id,
  });
  console.log(
    `[subscription-engine] Order ${orderId} placed AND paid for subscription ${sub.id} (${fulfillmentDate}), total=${draft.totalCents}¢, PI=${charge.pi.id}`,
  );
  return { outcome: "placed", orderId, totalCents: draft.totalCents, items: draft.items };
}

/**
 * An Abo created or resumed AFTER the 20:00 run but BEFORE the 22:00 cutoff
 * still gets this week's order — placed and paid right now, exactly as a
 * single order placed at that hour would be (owner, 05.10.2026). Before
 * 20:00 nothing happens here: the scheduled run will do it. After 22:00 the
 * next pickup is no longer the imminent one, so `getNextDateForSubscription`
 * already points to the following cycle and the run for it is still ahead.
 */
type PlaceNowResult = {
  placed_now: boolean;
  fulfillment_date: string | null;
  order_id: string | null;
  total_cents: number | null;
  reason?: "run_pending" | "not_active" | "paused" | "already_placed" | "no_items" | "payment_failed";
  error: string | null;
};

async function placeNowIfRunPassed(subscriptionId: string): Promise<PlaceNowResult> {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, pickup_day, status")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (!sub) return { placed_now: false, fulfillment_date: null, order_id: null, total_cents: null, error: "Subscription not found" };

  const fulfillmentDate = getNextDateForSubscription((sub.pickup_day as "wednesday" | "saturday" | "both") ?? "wednesday");
  const [y, m, d] = fulfillmentDate.split("-").map(Number);
  const orderDay = new Date(Date.UTC(y, m - 1, d));
  orderDay.setUTCDate(orderDay.getUTCDate() - 2);
  const runWall = `${orderDay.toISOString().slice(0, 10)}T20:00`;
  if (berlinWallClock(new Date()) < runWall) {
    return { placed_now: false, fulfillment_date: fulfillmentDate, order_id: null, total_cents: null, reason: "run_pending", error: null };
  }

  const currentWeek = await getCurrentWeekType();
  const r = await placeAndChargeSubscriptionOrder(sub.id, fulfillmentDate, currentWeek);
  switch (r.outcome) {
    case "placed":
      return { placed_now: true, fulfillment_date: fulfillmentDate, order_id: r.orderId, total_cents: r.totalCents, error: null };
    case "skipped":
      return { placed_now: false, fulfillment_date: fulfillmentDate, order_id: r.orderId, total_cents: null, reason: r.reason, error: null };
    case "payment_failed":
      return { placed_now: false, fulfillment_date: fulfillmentDate, order_id: null, total_cents: null, reason: "payment_failed", error: r.reason };
    case "would_place":
      return { placed_now: false, fulfillment_date: fulfillmentDate, order_id: null, total_cents: r.totalCents, error: null };
    default:
      return { placed_now: false, fulfillment_date: fulfillmentDate, order_id: null, total_cents: null, error: r.error };
  }
}

/**
 * 2. process_8pm_order_placement()
 *
 * Called at Monday/Thursday 20:00: automated placement of single orders for
 * every active subscription of this run's pickup day — each one placed and
 * paid by placeAndChargeSubscriptionOrder. From then on the row is an
 * ordinary paid order; at 22:00 process10pmLock locks it for production.
 *
 * `dryRun` / `dayOverride` (forced runs only) report the plan without
 * charging, writing or notifying.
 */
async function process8pmOrderPlacement(options?: {
  dryRun?: boolean;
  dayOverride?: "wednesday" | "saturday";
}): Promise<{
  fulfillmentDate: string;
  week: "A" | "B";
  ordersCreated: number;
  paymentsFailed: number;
  skippedSubscriptions: number;
  errors: string[];
  dryRun?: boolean;
  plan?: unknown[];
}> {
  const dryRun = options?.dryRun === true;
  const dow = currentDayOfWeek();
  const runDay: "wednesday" | "saturday" =
    options?.dayOverride ?? (dow === 1 ? "wednesday" : "saturday");
  const fulfillmentDate = options?.dayOverride
    ? getNextDateForPickupDay(options.dayOverride)
    : getNextFulfillmentDate();
  const currentWeek = await getCurrentWeekType();

  console.log(
    `[subscription-engine] process8pmOrderPlacement: ` +
      `fulfillmentDate=${fulfillmentDate}, week=${currentWeek}, day=${runDay}${dryRun ? " (DRY RUN)" : ""}`,
  );

  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select("id, customers!inner ( email )")
    .eq("status", "active")
    // A "both" Abo runs on Wednesday AND Saturday, so it belongs to both runs.
    .in("pickup_day", [runDay, "both"])
    .or(`paused_until.is.null,paused_until.lt.${fulfillmentDate}`);

  const result = {
    fulfillmentDate,
    week: currentWeek,
    ordersCreated: 0,
    paymentsFailed: 0,
    skippedSubscriptions: 0,
    errors: [] as string[],
  };
  if (subError) {
    console.error("[subscription-engine] Failed to fetch subscriptions for order placement:", subError);
    return { ...result, errors: [subError.message] };
  }
  if (!subscriptions || subscriptions.length === 0) {
    console.log("[subscription-engine] No subscriptions to process for order placement.");
    return dryRun ? { ...result, dryRun, plan: [] } : result;
  }

  const plan: unknown[] = [];
  for (const sub of subscriptions) {
    const email = (sub.customers as unknown as { email: string }).email;
    try {
      const r = await placeAndChargeSubscriptionOrder(sub.id, fulfillmentDate, currentWeek, dryRun);
      switch (r.outcome) {
        case "placed":
          result.ordersCreated++;
          break;
        case "would_place":
          plan.push({ subscription_id: sub.id, email, action: "charge_and_place", total_cents: r.totalCents, items: r.items.map((i) => `${i.quantity}× ${i.name}`) });
          break;
        case "skipped":
          result.skippedSubscriptions++;
          plan.push({ subscription_id: sub.id, email, action: `skip_${r.reason}`, order_id: r.orderId });
          console.log(`[subscription-engine] Subscription ${sub.id}: skipped (${r.reason}).`);
          break;
        case "payment_failed":
          result.paymentsFailed++;
          result.errors.push(`Subscription ${sub.id}: payment failed — ${r.reason}`);
          break;
        case "error":
          result.errors.push(`Subscription ${sub.id}: ${r.error}`);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Subscription ${sub.id}: ${msg}`);
      console.error(`[subscription-engine] Error processing order placement for subscription ${sub.id}:`, err);
    }
  }

  console.log(
    `[subscription-engine] process8pmOrderPlacement done: ` +
      `${result.ordersCreated} orders placed+paid, ${result.paymentsFailed} payments failed, ${result.skippedSubscriptions} skipped, ${result.errors.length} errors`,
  );
  return dryRun ? { ...result, dryRun, plan } : result;
}

/**
 * 3. process_10pm_lock()
 *
 * Called at Monday/Thursday 22:00 — the Bestellschluss. Nothing is charged
 * here any more (the 20:00 run pays as it places). This run only
 *   - moves every PAID order for the imminent pickup date (subscription and
 *     one-time alike) to 'locked_for_production': from now on no
 *     cancellation, the bread is being baked;
 *   - removes any UNPAID subscription row for that date, which must not exist
 *     under the "no order without payment" rule, and alerts the owner so the
 *     anomaly is seen.
 */
async function process10pmLock(): Promise<{
  fulfillmentDate: string;
  locked: number;
  removedUnpaid: number;
  errors: string[];
}> {
  const fulfillmentDate = getNextFulfillmentDate();
  console.log(`[subscription-engine] process10pmLock: locking paid orders for ${fulfillmentDate}`);

  let locked = 0;
  let removedUnpaid = 0;
  const errors: string[] = [];

  // 1. Lock every paid order for the pickup date.
  const { data: lockedRows, error: lockError } = await supabase
    .from("orders")
    .update({ status: "locked_for_production", updated_at: new Date().toISOString() })
    .eq("fulfillment_date", fulfillmentDate)
    .eq("payment_status", "paid")
    .in("status", ["scheduled", "grace_period_open"])
    .select("id, order_type");
  if (lockError) {
    errors.push(`lock: ${lockError.message}`);
    console.error("[subscription-engine] Failed to lock paid orders:", lockError);
  } else {
    locked = lockedRows?.length ?? 0;
    for (const row of lockedRows ?? []) {
      await logAudit("order_locked_for_production", "order", row.id as string,
        { status: "scheduled" }, { status: "locked_for_production", fulfillment_date: fulfillmentDate });
    }
    console.log(`[subscription-engine] Locked ${locked} paid order(s) for ${fulfillmentDate}.`);
  }

  // 2. Unpaid subscription rows for this date are not orders — drop them.
  const { data: unpaid, error: unpaidError } = await supabase
    .from("orders")
    .select("id, subscription_id, customer_name, customer_email, total_cents, payment_status, status")
    .eq("order_type", "subscription")
    .eq("fulfillment_date", fulfillmentDate)
    .neq("payment_status", "paid")
    .in("status", ["scheduled", "grace_period_open", "processing"]);
  if (unpaidError) {
    errors.push(`unpaid scan: ${unpaidError.message}`);
    console.error("[subscription-engine] Failed to scan unpaid subscription orders:", unpaidError);
  } else if (unpaid && unpaid.length > 0) {
    for (const o of unpaid) {
      await supabase.from("order_items").delete().eq("order_id", o.id);
      const { error: delErr } = await supabase.from("orders").delete().eq("id", o.id);
      if (delErr) {
        errors.push(`Order ${o.id}: could not remove unpaid row — ${delErr.message}`);
        continue;
      }
      removedUnpaid++;
      await logAudit("unpaid_subscription_order_removed", "order", o.id as string,
        { status: o.status, payment_status: o.payment_status },
        { subscription_id: o.subscription_id, fulfillment_date: fulfillmentDate, total_cents: o.total_cents });
    }
    await dispatchNotification(null, "admin_alert", "both", {
      category: "other",
      message:
        `Bestellschluss ${fulfillmentDate}: ${removedUnpaid} unbezahlte Abo-Bestellung(en) entfernt ` +
        `(${unpaid.map((o) => o.customer_name || o.customer_email).join(", ")}). Es wurde nichts abgebucht.`,
    });
    console.warn(`[subscription-engine] Removed ${removedUnpaid} unpaid subscription order(s) for ${fulfillmentDate}.`);
  }

  console.log(
    `[subscription-engine] process10pmLock done: ${locked} locked, ${removedUnpaid} unpaid removed, ${errors.length} errors`,
  );
  return { fulfillmentDate, locked, removedUnpaid, errors };
}

/**
 * 4. process_cancellations()
 *
 * Called at Monday/Thursday 22:00.
 * Subscriptions with status='cancellation_pending' get cancelled.
 */
/**
 * Resume subscriptions whose pause has run out.
 *
 * When a customer pauses, the app asks "bis wann?" and promises "Dein Abo wird
 * an diesem Tag automatisch fortgesetzt." Nothing kept that promise: order
 * generation selects `status = 'active'`, so a paused subscription was skipped
 * for ever and the resume date did nothing. The customer had to notice and tap
 * "Fortsetzen" themselves — otherwise the bread simply never came back.
 *
 * Runs from processCancellations (every 30 minutes) so a pause ends promptly.
 */
async function resumeExpiredPauses(): Promise<{ resumed: number }> {
  const today = todayInTz();
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ status: "active", paused_until: null })
    .eq("status", "paused")
    .not("paused_until", "is", null)
    .lte("paused_until", today)
    .select("id");

  if (error) {
    console.error("[subscription-engine] Failed to resume expired pauses:", error);
    return { resumed: 0 };
  }

  const resumed = data?.length ?? 0;
  if (resumed > 0) {
    console.log(
      `[subscription-engine] Resumed ${resumed} subscription(s) whose pause ended on or before ${today}.`,
    );
    // Normally the next 20:00 run places (and pays) the order. If a pause
    // ends after 20:00 on an order day, this week's order is placed now —
    // the same rule as for a manual resume.
    for (const row of data ?? []) {
      try {
        await placeNowIfRunPassed(row.id as string);
      } catch (err) {
        console.error(`[subscription-engine] Auto-resume: placement check failed for ${row.id}:`, err);
      }
    }
  }
  return { resumed };
}

async function processCancellations(): Promise<{
  cancelled: number;
  resumed: number;
  errors: string[];
}> {
  console.log("[subscription-engine] processCancellations: processing");

  // Piggy-backs on this job because it is the only frequent one (*/30).
  const { resumed } = await resumeExpiredPauses();

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
    return { cancelled: 0, resumed, errors: [subError.message] };
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log("[subscription-engine] No cancellation_pending subscriptions.");
    return { cancelled: 0, resumed, errors: [] };
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
      await dispatchNotification(sub.customer_id, "subscription_cancelled", "both", {
        subscription_id: sub.id,
      });

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
      `${cancelled} cancelled, ${resumed} resumed, ${errors.length} errors`,
  );
  return { cancelled, resumed, errors };
}

/**
 * What the 20:00 run WOULD place for one subscription — nothing is written.
 *
 * Until 05.10.2026 this path pre-created an unpaid "Vorgemerkt" order on
 * subscribe / resume / edit, which the 22:00 run then charged. Owner's rule:
 * an order exists only once it is paid, and payment happens at 20:00 on the
 * order day. So the clients get a preview here (date, items, total) and the
 * order itself is born — paid — in process8pmOrderPlacement.
 *
 * `reason` when nothing would be placed:
 *   'not_active'         — paused / payment_failed / cancelled subscription
 *   'paused'             — the pause still covers that date
 *   'no_items_this_week' — nothing in the basket is baked that day/week
 *   'already_placed'     — that date's order exists and is paid (order_id set)
 */
type PreviewResult = {
  success: boolean;
  fulfillment_date: string | null;
  items: { product_id: string; name: string; quantity: number; unit_price_cents: number }[];
  total_cents: number;
  order_id: string | null;
  reason?: "not_active" | "paused" | "no_items_this_week" | "already_placed";
  error: string | null;
};

async function previewSubscriptionOrder(
  subscriptionId: string,
  options?: { fulfillmentDate?: string },
): Promise<PreviewResult> {
  const none = (
    reason: PreviewResult["reason"] | undefined,
    error: string | null,
    fulfillmentDate: string | null = null,
    orderId: string | null = null,
  ): PreviewResult => ({
    success: false,
    fulfillment_date: fulfillmentDate,
    items: [],
    total_cents: 0,
    order_id: orderId,
    ...(reason ? { reason } : {}),
    error,
  });

  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select("id, pickup_day, status, paused_until")
    .eq("id", subscriptionId)
    .single();
  if (subError || !sub) {
    return none(undefined, subError?.message ?? "Subscription not found");
  }

  const subPickupDay = (sub.pickup_day as "wednesday" | "saturday" | "both") ?? "wednesday";
  const fulfillmentDate = options?.fulfillmentDate ?? getNextDateForSubscription(subPickupDay);

  if (sub.status !== "active") return none("not_active", null, fulfillmentDate);
  if (sub.paused_until && (sub.paused_until as string) >= fulfillmentDate) {
    return none("paused", null, fulfillmentDate);
  }

  const { data: existing } = await supabase
    .from("orders")
    .select("id, payment_status")
    .eq("idempotency_key", `sub_${sub.id}_${fulfillmentDate}`)
    .maybeSingle();
  if (existing && existing.payment_status === "paid") {
    return none("already_placed", null, fulfillmentDate, existing.id);
  }

  const currentWeek = await getCurrentWeekType();
  const draft = await buildSubscriptionDraft(sub.id, fulfillmentDate, currentWeek);
  if (draft.error) return none(undefined, draft.error, fulfillmentDate);
  if (draft.items.length === 0) return none("no_items_this_week", null, fulfillmentDate);

  return {
    success: true,
    fulfillment_date: fulfillmentDate,
    items: draft.items,
    total_cents: draft.totalCents,
    order_id: null,
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
  const today = todayInTz();

  // "Pausiert bis X" is inclusive and the auto-resume matches
  // `paused_until <= today` every 30 minutes, so a resume date of today (or
  // earlier) would be undone almost immediately — a zero-length pause that
  // still deleted the pending order. Validated HERE, not only in a client,
  // so the app, the website and any direct caller all get the same rule.
  // Berlin calendar date on both sides (todayInTz), never UTC.
  if (resumeDate && resumeDate <= today) {
    return {
      success: false,
      removedOrders: 0,
      error: "Das Pause-Ende muss in der Zukunft liegen.",
    };
  }

  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      status: "paused",
      paused_until: resumeDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);
  if (subErr) return { success: false, removedOrders: 0, error: subErr.message };

  // Remove only the orders the pause actually covers: fulfillment dates from
  // today up to and INCLUDING paused_until (order generation is blocked while
  // `paused_until >= fulfillment_date`, see previewSubscriptionOrder). Since
  // 05.10.2026 no unpaid subscription order exists any more (the 20:00 run
  // pays as it places), so this is a safety net for leftovers only. A PAID
  // order is never touched by a pause — the customer cancels it separately
  // (refund) until the 22:00 cutoff if they do not want it.
  let ordersQuery = supabase
    .from("orders")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("order_type", "subscription")
    .in("status", ["scheduled", "grace_period_open"])
    .eq("payment_status", "pending")
    .gte("fulfillment_date", today);
  if (resumeDate) ordersQuery = ordersQuery.lte("fulfillment_date", resumeDate);
  const { data: orders } = await ordersQuery;

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
 * Resume a paused subscription. The next 20:00 run places and pays the
 * order — unless that run has already passed today and the cutoff has not:
 * then this week's order is placed and paid right now (placeNowIfRunPassed),
 * and the response says for which pickup date.
 */
async function resumeSubscription(
  subscriptionId: string,
): Promise<{ success: boolean; orderId: string | null; error: string | null } & Partial<PlaceNowResult>> {
  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      paused_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);
  if (subErr) return { success: false, orderId: null, error: subErr.message };

  const now = await placeNowIfRunPassed(subscriptionId);
  await logAudit("subscription_resumed", "subscription", subscriptionId, null, {
    placed_now: now.placed_now,
    order_id: now.order_id,
    fulfillment_date: now.fulfillment_date,
  });
  return { success: true, ...now, orderId: now.order_id, error: null };
}

/**
 * Customer-facing: modify an active/paused subscription's items (and optionally
 * its pickup location). Ownership is verified against the caller's user id.
 *
 * Items are only saved: the 20:00 run builds the order from them. Until that
 * run the change applies to this week's order; once this week's order is
 * placed and paid, the change applies from the next delivery (no refund /
 * recharge, no second transaction).
 */
/**
 * `reason` explains an applied_this_week === false, so the client can say
 * something useful instead of a bare "saved":
 *   'no_items_this_week' — nothing in the basket is baked this week (A/B
 *                          cycle or day availability), so there is no order
 *   'already_charged'    — this week's order is placed and paid; change applies next time
 *   'paused'             — a paused Abo gets its order when it resumes
 *   'payment_failed'     — no order until the customer reactivates the Abo
 */
type UpdateResult = {
  success: boolean;
  applied_this_week: boolean;
  reason?: "no_items_this_week" | "already_charged" | "paused" | "payment_failed";
  error: string | null;
};

async function updateSubscription(
  userId: string,
  subscriptionId: string,
  items: { product_id: string; quantity: number }[],
  pickupLocationId: string | null,
): Promise<UpdateResult> {
  // 1. Ownership + editable status
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, customer_id, status, pickup_day, pickup_location_id")
    .eq("id", subscriptionId)
    .single();
  if (subErr || !sub) return { success: false, applied_this_week: false, error: "Subscription not found" };
  if (sub.customer_id !== userId) return { success: false, applied_this_week: false, error: "Not your subscription" };
  // payment_failed is editable like paused: the items are saved now and the
  // order is generated when the Abo is reactivated (resume). Without this the
  // app's "Bearbeiten" button on a payment_failed Abo was a dead end.
  if (sub.status !== "active" && sub.status !== "paused" && sub.status !== "payment_failed") {
    return { success: false, applied_this_week: false, error: `Cannot edit a ${sub.status} subscription` };
  }

  // 2. Validate items (server-side — never trust client prices/products)
  const clean = (items ?? [])
    .filter((i) => i && i.product_id && Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => ({ product_id: i.product_id, quantity: Math.min(99, Math.floor(i.quantity)) }));
  if (clean.length === 0) return { success: false, applied_this_week: false, error: "At least one item is required" };
  const { data: prods } = await supabase.from("products").select("id, subscribable, price_cents").in("id", clean.map((i) => i.product_id));
  const okIds = new Set((prods ?? []).filter((p) => p.subscribable !== false).map((p) => p.id));
  if (clean.some((i) => !okIds.has(i.product_id))) {
    return { success: false, applied_this_week: false, error: "Product not available for subscription" };
  }
  // Business rule (owner, 2026-09-02): a delivery above 250 € needs individual
  // arrangement. Same cap as one-time checkout; enforced here because Abo
  // edits are the one server-routed way to grow an existing Abo's basket.
  const priceById = new Map((prods ?? []).map((p) => [p.id, p.price_cents as number]));
  const deliveryCents = clean.reduce((sum, i) => sum + (priceById.get(i.product_id) ?? 0) * i.quantity, 0);
  if (deliveryCents > 25000) {
    return {
      success: false,
      applied_this_week: false,
      error: "Für Abos über 250 € pro Lieferung kontaktiere uns bitte vorab über das Kontaktformular – wir vereinbaren die Details individuell.",
    };
  }

  // 3. Optional pickup-location change
  let locId = sub.pickup_location_id;
  if (pickupLocationId && pickupLocationId !== sub.pickup_location_id) {
    const { data: loc } = await supabase
      .from("pickup_locations").select("id").eq("id", pickupLocationId).eq("active", true).maybeSingle();
    if (!loc) return { success: false, applied_this_week: false, error: "Invalid pickup location" };
    locId = pickupLocationId;
    const { error: locErr } = await supabase.from("subscriptions")
      .update({ pickup_location_id: locId, updated_at: new Date().toISOString() }).eq("id", sub.id);
    if (locErr) {
      // e.g. the day/location guard (migration 019): a Saturday Abo cannot move
      // to a Wednesday-only location. Never report success for a change that
      // did not happen.
      return { success: false, applied_this_week: false, error: locErr.message };
    }
  }

  // 4. Replace the subscription's items
  await supabase.from("subscription_items").delete().eq("subscription_id", sub.id);
  const { error: insErr } = await supabase.from("subscription_items")
    .insert(clean.map((i) => ({ subscription_id: sub.id, product_id: i.product_id, quantity: i.quantity })));
  if (insErr) return { success: false, applied_this_week: false, error: insErr.message };

  // 5. Tell the client whether the change lands on THIS week's order. Nothing
  //    is written here: the 20:00 run builds and pays the order from the
  //    saved items.
  let appliedThisWeek = false;
  let reason: UpdateResult["reason"];
  if (sub.status === "active") {
    const preview = await previewSubscriptionOrder(sub.id);
    if (preview.reason === "already_placed") {
      reason = "already_charged";
    } else if (preview.success) {
      appliedThisWeek = true;
    } else {
      // The preview can legitimately be empty — e.g. the basket now holds
      // only a week_a bread and this is week B. Correct, but the customer
      // must be told, or they simply get no bread with no explanation after
      // being shown "saved".
      reason = "no_items_this_week";
    }
  } else if (sub.status === "paused") {
    reason = "paused";
  } else if (sub.status === "payment_failed") {
    reason = "payment_failed";
  }

  return { success: true, applied_this_week: appliedThisWeek, reason, error: null };
}

/**
 * Ownership guard for EVERY customer-facing subscription action.
 *
 * This function is deployed --no-verify-jwt so that cron can reach it, which
 * means neither the platform nor the router above authenticates anybody: each
 * customer-facing route must verify the caller's JWT and their ownership of
 * the subscription itself. A pause changes what gets charged at 20:00 and the
 * preview reveals someone's basket, so an unauthenticated caller holding a
 * UUID could interfere with — or read — someone else's bread. The internal engine paths (crons, auto-resume)
 * call the worker functions directly and never pass through this guard.
 *
 * Returns the caller's user id when they own the subscription, or the error
 * Response to send.
 */
async function requireSubscriptionOwner(
  req: Request,
  subscriptionId: string,
): Promise<{ userId: string } | Response> {
  const jsonErr = (error: string, status: number) => json({ error }, status);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  // Authenticate FIRST, look the subscription up second: an anonymous caller
  // must get the same 401 whether or not the UUID exists — a 404 here would
  // confirm valid subscription ids to outsiders.
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return jsonErr("Unauthorized", 401);

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("customer_id")
    .eq("id", subscriptionId)
    .single();
  if (subErr || !sub) return jsonErr("Subscription not found", 404);

  if (sub.customer_id !== user.id) {
    // Not the owner — but the shop's ADMIN may act on the owner's behalf
    // (pausing an Abo for a customer at the counter; the web admin's Abos
    // page). Checked against customers.is_admin, so it is a real, revocable
    // role and the audit trail names the person. NOTE: deliberately not a
    // service-key comparison — the platform injects a DIFFERENT key value
    // into this runtime than the one our servers hold, so key equality
    // silently fails across environments (verified live).
    const { data: caller } = await supabase
      .from("customers")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!caller?.is_admin) return jsonErr("Nicht autorisiert.", 403);
    return { userId: sub.customer_id as string };
  }

  return { userId: user.id };
}

// ── HTTP Router ──────────────────────────────────────────────

// The website calls pause/resume/update-subscription from the BROWSER, whose
// CORS preflight (OPTIONS) previously hit the bare "POST only" branch with no
// Access-Control headers — the browser then blocked the real request.
// Wrapping the router answers the preflight and stamps the headers onto every
// response without touching the individual Response literals. Same header set
// as the sibling delete-account function.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function withCors(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  };
}

serve(withCors(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  // Allow invocation via path (e.g., /process-12pm-reminders) or
  // via query parameter (e.g., ?action=process-12pm-reminders) for
  // compatibility with different cron trigger setups.
  const actionParam = url.searchParams.get("action");
  const action = actionParam ?? path.split("/").pop() ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  // ── Cron-only actions require the shared cron secret ──
  // This function is --no-verify-jwt, so without this anyone could run the
  // reminder/placement/charge/cancellation loops out of band. The pg_net cron
  // jobs send the secret as Bearer (they read it from Vault at run time,
  // migration 024); the service-role key is accepted too for manual owner
  // invocations. Customer actions are guarded per-subscription further down.
  const CRON_ONLY = new Set([
    "process-12pm-reminders", "process_12pm_reminders",
    "process-8pm-order-placement", "process_8pm_order_placement",
    "process-10pm-lock", "process_10pm_lock",
    "process-cancellations", "process_cancellations",
    "process-order-reminders", "process_order_reminders",
  ]);
  if (CRON_ONLY.has(action)) {
    const ok =
      (CRON_SECRET.length > 0 && bearer === CRON_SECRET) ||
      (SUPABASE_SERVICE_ROLE_KEY.length > 0 && bearer === SUPABASE_SERVICE_ROLE_KEY);
    if (!ok) return json({ error: "Unauthorized" }, 401);
  }

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
    "process-order-reminders": 12,
    "process_order_reminders": 12,
  };
  const expectedHour = GUARDED_HOURS[action];
  let forcedRun = false;
  if (expectedHour !== undefined) {
    // `?force=1` bypasses the hour guard for manual/testing invocation — but
    // forcing the 22:00 charge loop early is exactly what an outsider must
    // never be able to do on a --no-verify-jwt function, so force requires
    // the service-role key as Bearer (the cron gate above already vetted the
    // caller; this is the stricter bar for overriding the schedule itself).
    // The cron secret, not the service key: the platform injects a service
    // key VALUE into this runtime that differs from the one stored in
    // .credentials, so a service-key comparison never matches for the owner.
    const forced =
      url.searchParams.get("force") === "1" &&
      ((CRON_SECRET.length > 0 && bearer === CRON_SECRET) ||
        (SUPABASE_SERVICE_ROLE_KEY.length > 0 && bearer === SUPABASE_SERVICE_ROLE_KEY));
    forcedRun = forced;
    if (!forced) {
      const h = berlinHour();
      if (h !== expectedHour) {
        return json({
          skipped: true,
          reason: `DST guard: Berlin hour ${h} != expected ${expectedHour}. No-op firing of the dual UTC schedule.`,
        });
      }
    }
  }

  try {
    switch (action) {
      case "process-12pm-reminders":
      case "process_12pm_reminders": {
        const result = await process12pmReminders();
        return json(result);
      }

      case "process-order-reminders":
      case "process_order_reminders": {
        // `day=` only for forced (cron-secret/service-key) test runs on other weekdays.
        const dayParam = forcedRun ? (url.searchParams.get("day") ?? undefined) : undefined;
        const result = await processOrderReminders(dayParam);
        return json(result);
      }

      case "process-8pm-order-placement":
      case "process_8pm_order_placement": {
        // `dry=1` / `day=` only for forced (cron-secret) manual runs: plan
        // without charging. The scheduled run never takes either.
        const dayParam = url.searchParams.get("day");
        const result = await process8pmOrderPlacement(
          forcedRun
            ? {
              dryRun: url.searchParams.get("dry") === "1",
              dayOverride: dayParam === "wednesday" || dayParam === "saturday" ? dayParam : undefined,
            }
            : undefined,
        );
        return json(result);
      }

      case "process-10pm-lock":
      case "process_10pm_lock": {
        const result = await process10pmLock();
        return json(result);
      }

      case "process-cancellations":
      case "process_cancellations": {
        const result = await processCancellations();
        // Piggyback (28.09.2026): the abandoned-checkout mails ride on this
        // 30-minute cron instead of a schedule of their own. Best-effort.
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/abandoned-checkouts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            signal: AbortSignal.timeout(25000),
          });
        } catch (e) {
          console.warn("[subscription-engine] abandoned-checkouts call failed:", e instanceof Error ? e.message : e);
        }
        return json(result);
      }

      case "process-single-subscription":
      case "process_single_subscription": {
        let body: { subscription_id?: string; fulfillment_date?: string };
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        if (!body.subscription_id) {
          return json({ error: "subscription_id is required" }, 400);
        }

        // Called by the clients right after creating an Abo. Two jobs:
        //  - if today's 20:00 run has already passed (and the 22:00 cutoff
        //    has not), place and pay this week's order NOW — like a single
        //    order at that hour (owner, 05.10.2026);
        //  - otherwise report what the next run will place (preview, no
        //    writes) so the client can say for which pickup date.
        // Same ownership rule as pause/resume.
        const auth = await requireSubscriptionOwner(req, body.subscription_id);
        if (auth instanceof Response) return auth;

        const now = await placeNowIfRunPassed(body.subscription_id);
        const preview = await previewSubscriptionOrder(body.subscription_id, {
          fulfillmentDate: body.fulfillment_date,
        });
        return json({ ...preview, ...now, success: now.placed_now || preview.success });
      }

      // One case group: the two routes are identical except for the worker
      // call, and the ownership guard must never be pasted per-route again.
      case "pause":
      case "pause-subscription":
      case "resume":
      case "resume-subscription": {
        let body: { subscription_id?: string; resume_date?: string };
        try { body = await req.json(); } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        if (!body.subscription_id) {
          return json({ error: "subscription_id is required" }, 400);
        }
        const auth = await requireSubscriptionOwner(req, body.subscription_id);
        if (auth instanceof Response) return auth;
        const result = action.startsWith("pause")
          ? await pauseSubscription(body.subscription_id, body.resume_date ?? null)
          : await resumeSubscription(body.subscription_id);
        return json(result, result.success ? 200 : 400);
      }

      case "update-subscription": {
        let body: { subscription_id?: string; items?: { product_id: string; quantity: number }[]; pickup_location_id?: string | null };
        try { body = await req.json(); } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        if (!body.subscription_id || !Array.isArray(body.items)) {
          return json({ error: "subscription_id and items are required" }, 400);
        }
        const auth = await requireSubscriptionOwner(req, body.subscription_id);
        if (auth instanceof Response) return auth;
        const result = await updateSubscription(auth.userId, body.subscription_id, body.items, body.pickup_location_id ?? null);
        return json(result, result.success ? 200 : 400);
      }

      /**
       * "Mach daraus ein Abo" — turn a paid one-time order into a subscription
       * with the same products, Abholort and weekday (tester request).
       *
       * Two rules make it safe:
       * - A saved payment method is REQUIRED (the 20:00 run charges
       *   off-session). Checkouts save the card (setup_future_usage), but if
       *   none is on file the client gets needs_payment_method and runs its
       *   card-setup flow first.
       * - If the bought pickup date is still ahead, the subscription starts
       *   PAUSED until that date. Otherwise the Mon/Thu run would generate an
       *   Abo order for the very date the customer already bought — double
       *   bread. The auto-resume flips it active ON that date, and the cutoff
       *   rule makes the first Abo order the next cycle. The clients word it
       *   as "läuft ab der nächsten Lieferung".
       */
      case "convert-order-to-subscription": {
        let body: { order_id?: string };
        try { body = await req.json(); } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        if (!body.order_id) return json({ error: "order_id is required" }, 400);

        const { data: { user }, error: authErr } = await supabase.auth.getUser(bearer);
        if (authErr || !user) return json({ error: "Unauthorized" }, 401);

        const { data: order, error: ordErr } = await supabase
          .from("orders")
          .select("id, customer_id, customer_email, customer_name, order_type, payment_status, status, fulfillment_date, pickup_location_id")
          .eq("id", body.order_id)
          .single();
        if (ordErr || !order) return json({ error: "Bestellung nicht gefunden" }, 404);
        if (order.customer_id !== user.id) {
          const { data: caller } = await supabase
            .from("customers").select("is_admin").eq("id", user.id).single();
          if (!caller?.is_admin) return json({ error: "Nicht autorisiert." }, 403);
        }
        if (order.order_type !== "one_time") {
          return json({ success: false, error: "Diese Bestellung gehört bereits zu einem Abo." }, 409);
        }
        if (order.payment_status !== "paid" || order.status === "cancelled" || order.status === "refunded") {
          return json({ success: false, error: "Nur eine bezahlte, nicht stornierte Bestellung kann zum Abo werden." }, 409);
        }

        // The weekly charge needs a card on file.
        const stripeCustomer = await getOrCreateStripeCustomer(
          order.customer_id as string,
          (order.customer_email as string) ?? "",
          (order.customer_name as string) ?? "",
        );
        const pm = stripeCustomer ? await getDefaultPaymentMethod(stripeCustomer.id) : null;
        if (!pm) {
          return json({
            success: false,
            needs_payment_method: true,
            error: "Keine gespeicherte Zahlungsmethode — bitte zuerst eine Karte hinterlegen.",
          }, 409);
        }

        // Only subscribable products can recur; the rest is reported back so
        // the client can say what was left out.
        const { data: rawItems } = await supabase
          .from("order_items")
          .select("quantity, products!inner ( id, name, subscribable, cycle )")
          .eq("order_id", order.id);
        const subItems: { product_id: string; quantity: number }[] = [];
        const excluded: string[] = [];
        for (const it of rawItems ?? []) {
          const prod = it.products as unknown as { id: string; name: string; subscribable: boolean; cycle: string };
          if (prod.subscribable === false || prod.cycle === "hidden") excluded.push(prod.name);
          else subItems.push({ product_id: prod.id, quantity: it.quantity as number });
        }
        if (subItems.length === 0) {
          return json({ success: false, error: "Keines der Produkte ist im Abo erhältlich." }, 409);
        }

        const dowNum = new Date((order.fulfillment_date as string) + "T12:00:00Z").getUTCDay();
        const pickupDay = dowNum === 6 ? "saturday" : "wednesday";
        const startsPaused = (order.fulfillment_date as string) >= todayInTz();

        const { data: sub, error: subErr } = await supabase
          .from("subscriptions")
          .insert({
            customer_id: order.customer_id,
            pickup_location_id: order.pickup_location_id,
            pickup_day: pickupDay,
            status: startsPaused ? "paused" : "active",
            paused_until: startsPaused ? order.fulfillment_date : null,
          })
          .select("id")
          .single();
        if (subErr || !sub) return json({ success: false, error: subErr?.message ?? "Abo konnte nicht angelegt werden." }, 500);

        const { error: itemsErr } = await supabase
          .from("subscription_items")
          .insert(subItems.map((i) => ({ subscription_id: sub.id, ...i })));
        if (itemsErr) {
          await supabase.from("subscriptions").delete().eq("id", sub.id);
          return json({ success: false, error: itemsErr.message }, 500);
        }

        await logAudit("order_converted_to_subscription", "subscription", sub.id, null, {
          order_id: order.id,
          pickup_day: pickupDay,
          items: subItems.length,
          excluded_items: excluded,
          starts_paused_until: startsPaused ? order.fulfillment_date : null,
        });

        // An Abo that starts active right now follows the same rule as a
        // fresh one: after today's 20:00 run (and before 22:00) this week's
        // order is placed and paid immediately.
        const now = startsPaused
          ? null
          : await placeNowIfRunPassed(sub.id as string);

        return json({
          success: true,
          subscription_id: sub.id,
          pickup_day: pickupDay,
          excluded_items: excluded,
          ...(now ?? {}),
        });
      }

      default: {
        // If no recognized action, return available endpoints
        return json({
          error: "Unknown action",
          available_actions: [
            "process-12pm-reminders",
            "process-8pm-order-placement",
            "process-10pm-lock",
            "process-cancellations",
            "process-order-reminders",
            "process-single-subscription",
            "pause",
            "resume",
            "update-subscription",
            "convert-order-to-subscription",
          ],
        }, 404);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[subscription-engine] Unhandled error:", message);
    return json({ error: message }, 500);
  }
}));
