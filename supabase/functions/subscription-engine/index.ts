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
  apiVersion: "2025-03-31.basil",
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
  invoiceNumber: string,
  fulfillmentDate: string,
): string {
  const customerName = customer.name ?? "Kunde";
  const customerEmail = customer.email ?? "";

  return `
    <div style="font-family: 'Helvetica', 'Arial', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333;">
      <div style="border-bottom: 3px solid #f7140f; padding-bottom: 10px; margin-bottom: 20px;">
        <h1 style="color: #f7140f; font-size: 24px; margin: 0;">Smittenbrot</h1>
        <p style="margin: 4px 0 0; color: #666; font-size: 13px;">Handgemachtes Sauerteigbrot aus Stockdorf</p>
      </div>

      <h2 style="font-size: 18px; color: #f7140f;">Rechnung ${invoiceNumber}</h2>

      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 10px;">
            <div style="background: #F3F4F6; padding: 10px; border-radius: 6px;">
              <strong style="font-size: 12px; color: #666;">Kunde</strong>
              <p style="margin: 4px 0; font-size: 13px;">
                ${customerName}<br>
                ${customerEmail}
              </p>
            </div>
          </td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px;">
        <tr>
          <td style="padding: 2px 0; color: #666;">Rechnungsdatum:</td>
          <td style="padding: 2px 0; text-align: right;">${new Date().toLocaleDateString("de-DE")}</td>
        </tr>
        <tr>
          <td style="padding: 2px 0; color: #666;">Leistungsdatum (Abholung):</td>
          <td style="padding: 2px 0; text-align: right;">${new Date(fulfillmentDate + "T12:00:00").toLocaleDateString("de-DE")}</td>
        </tr>
        <tr>
          <td style="padding: 2px 0; color: #666;">Bestellnummer:</td>
          <td style="padding: 2px 0; text-align: right;">${invoiceNumber}</td>
        </tr>
      </table>

      <p style="font-size: 12px; color: #666;">Vielen Dank für deine Bestellung bei Smittenbrot. Die Zahlung wurde erfolgreich verarbeitet.</p>

      <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

      <p style="font-size: 11px; color: #999; text-align: center;">
        Smittenbrot · Stockdorf bei München<br>
        E-Mail: hello@smittenbrot.de<br>
        Zahlung erfolgt über Stripe<br>
        Es gilt die 7% ermäßigte Mehrwertsteuer auf Lebensmittel.
      </p>
    </div>
  `.trim();
}

/**
 * Insert a notification record.
 */
async function insertNotification(
  customerId: string | null,
  type: string,
  channel: string,
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    customer_id: customerId,
    type,
    channel,
    sent_at: new Date().toISOString(),
    delivered: false,
  });

  if (error) {
    console.error(
      `[subscription-engine] Failed to insert notification (${type}):`,
      error,
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
        push_token
      )
    `)
    .eq("status", "active")
    .or("paused_until.is.null,paused_until.lt.${todayInTz()}");

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

  for (const sub of subscriptions) {
    try {
      const customer = sub.customers as unknown as {
        id: string;
        email: string;
        name: string;
        push_token: string | null;
      };

      // Determine notification channel based on push_token availability
      const channel = customer.push_token ? "both" : "email";

      // Insert notification record
      await insertNotification(
        customer.id,
        "subscription_reminder",
        channel,
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
        push_token
      )
    `)
    .eq("status", "active")
    .or("paused_until.is.null,paused_until.lt.${todayInTz()}");

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
        console.log(
          `[subscription-engine] Order already exists for subscription ${sub.id} on ${fulfillmentDate}. Skipping.`,
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
          status: "grace_period_open",
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

      // Send notification that order was placed
      await insertNotification(
        customer.id,
        "order_placed",
        customer.push_token ? "both" : "email",
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
    .eq("status", "grace_period_open")
    .eq("order_type", "subscription");

  if (ordersError) {
    console.error(
      "[subscription-engine] Failed to fetch grace_period_open orders:",
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
        .eq("status", "grace_period_open"); // Conditional update for safety

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
              const invoiceNumber = order.id.substring(0, 8).toUpperCase();
              const fulfillmentDate = await getFulfillmentDateFromOrder(order.id);
              
              const htmlReceipt = buildReceiptHtml(order, customer, invoiceNumber, fulfillmentDate);
              
              // Send via Brevo API directly
              const brevoPayload = {
                sender: { email: "hello@smittenbrot.de", name: "Smittenbrot" },
                to: [{ email: customerEmail }],
                subject: `Deine Smittenbrot Rechnung ${invoiceNumber}`,
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
                } else {
                  console.warn(`[subscription-engine] Failed to send receipt: ${await brevoResp.text()}`);
                }
              }
            } catch (receiptError) {
              console.warn(`[subscription-engine] Receipt sending error for order ${order.id}:`, receiptError);
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
        await insertNotification(customer.id, "payment_failed", "both");

        // Send admin alert about payment failure
        await insertNotification(null, "admin_alert", "both");

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
      await insertNotification(sub.customer_id, "subscription_cancelled", "both");

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
  const fulfillmentDate = options?.fulfillmentDate ?? getNextFulfillmentDate();
  const skipIfExisting = options?.skipIfExisting ?? true;

  // Determine pickup day column based on the fulfillment date's day of week
  const fulfillmentDow = new Date(fulfillmentDate).getDay();
  // Wednesday = 3, Saturday = 6
  const pickupDayColumn = fulfillmentDow === 3 ? "available_wed" : "available_sat";

  // Get current week type
  const currentWeek = await getCurrentWeekType();

  console.log(
    `[subscription-engine] processSingleSubscription: ` +
      `sub=${subscriptionId}, fulfillmentDate=${fulfillmentDate}, week=${currentWeek}`,
  );

  // Fetch subscription with customer details
  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      id,
      customer_id,
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
      status: "grace_period_open",
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

  // Send placed notification
  await insertNotification(
    customer.id,
    "order_placed",
    customer.push_token ? "both" : "email",
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

  console.log(
    `[subscription-engine] Single order ${order.id} created for subscription ${sub.id}`,
  );

  return {
    orderId: order.id,
    success: true,
    error: null,
  };
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
