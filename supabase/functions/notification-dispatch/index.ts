// ============================================================
// Smittenbrot — Notification Dispatch Edge Function
// ============================================================
// Provides reusable notification functions that can be called
// from other edge functions or triggered via database hooks.
//
// Channels:
//   - Email via Brevo (Sendinblue) API
//   - Push via Expo Push API
//
// Env vars required:
//   BREVO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { serve } from "std/http/server";

// ── Environment Variables ────────────────────────────────────

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "sophia@smittenbrot.de";
// Public site URL — used to build the email unsubscribe link.
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://smittenbrot-website.vercel.app").replace(/\/+$/, "");

// ── Clients ──────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ── Constants ────────────────────────────────────────────────

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
const SENDER_EMAIL = "info@smittenbrot.de";

// ── Logging Helper ───────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const tag = "[notification-dispatch]";
  const timestamp = new Date().toISOString();
  const prefix = `${tag} [${level.toUpperCase()}] ${timestamp}`;
  if (level === "error") {
    console.error(`${prefix} ${message}`, meta ?? "");
  } else if (level === "warn") {
    console.warn(`${prefix} ${message}`, meta ?? "");
  } else {
    console.log(`${prefix} ${message}`, meta ?? "");
  }
}

// ═════════════════════════════════════════════════════════════
// 1. send_email — Send transactional email via Brevo API
// ═════════════════════════════════════════════════════════════

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via the Brevo (Sendinblue) v3 SMTP API.
 *
 * @param to          Recipient email address
 * @param subject     Email subject line
 * @param htmlContent HTML body content (must be valid HTML)
 * @returns           Result with success flag and optional message ID or error
 */
export async function send_email(
  to: string,
  subject: string,
  htmlContent: string,
): Promise<SendEmailResult> {
  if (!BREVO_API_KEY) {
    const msg = "BREVO_API_KEY is not configured";
    log("error", msg);
    return { success: false, error: msg };
  }

  if (!to) {
    const msg = "Recipient email is empty";
    log("error", msg);
    return { success: false, error: msg };
  }

  const payload = {
    sender: { email: SENDER_EMAIL, name: "Smittenbrot" },
    to: [{ email: to }],
    subject,
    htmlContent,
  };

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json();

    if (!response.ok) {
      const msg = `Brevo API error (${response.status}): ${JSON.stringify(body)}`;
      log("error", msg);
      return { success: false, error: msg };
    }

    log("info", `Email sent to ${to}: subject="${subject}" messageId=${body.messageId ?? "unknown"}`);
    return {
      success: true,
      messageId: body.messageId as string | undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `Failed to send email to ${to}: ${msg}`);
    return { success: false, error: msg };
  }
}

// ═════════════════════════════════════════════════════════════
// 2. send_push — Send push notifications via Expo Push API
// ═════════════════════════════════════════════════════════════

export interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SendPushResult {
  success: boolean;
  tickets: PushTicket[];
  error?: string;
}

/**
 * Send push notifications via the Expo Push API.
 *
 * Accepts an array of push tokens so multiple devices can be notified at once.
 *
 * @param pushTokens  Array of Expo push tokens (ExponentPushToken[xxxx] or similar)
 * @param title       Notification title
 * @param body        Notification body text
 * @param data        Optional JSON data payload to attach
 * @returns           Result with push ticket IDs
 */
export async function send_push(
  pushTokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<SendPushResult> {
  if (!pushTokens || pushTokens.length === 0) {
    const msg = "No push tokens provided";
    log("warn", msg);
    return { success: true, tickets: [] };
  }

  // Filter out any null/empty tokens
  const validTokens = pushTokens.filter((t) => t && t.trim().length > 0);
  if (validTokens.length === 0) {
    const msg = "All push tokens were empty or null";
    log("warn", msg);
    return { success: true, tickets: [] };
  }

  // Build the messages array — one per token
  const messages = validTokens.map((token) => ({
    to: token,
    sound: "default" as const,
    title,
    body,
    ...(data ? { data } : {}),
  }));

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const body = await response.json();

    if (!response.ok) {
      const msg = `Expo Push API error (${response.status}): ${JSON.stringify(body)}`;
      log("error", msg);
      return { success: false, tickets: [], error: msg };
    }

    // Expo returns a 'data' array of ticket objects
    const tickets: PushTicket[] = (body.data ?? []).map(
      (ticket: Record<string, unknown>) => ({
        status: (ticket.status as "ok" | "error") ?? "error",
        id: ticket.id as string | undefined,
        message: ticket.message as string | undefined,
        details: ticket.details as Record<string, unknown> | undefined,
      }),
    );

    const okCount = tickets.filter((t) => t.status === "ok").length;
    const errCount = tickets.filter((t) => t.status === "error").length;
    log(
      "info",
      `Push sent to ${validTokens.length} device(s): ${okCount} ok, ${errCount} errors`,
      { ticketIds: tickets.filter((t) => t.id).map((t) => t.id) },
    );

    return { success: errCount === 0, tickets };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `Failed to send push notification: ${msg}`);
    return { success: false, tickets: [], error: msg };
  }
}

// ═════════════════════════════════════════════════════════════
// 3. send_notification — Send via appropriate channels & log
// ═════════════════════════════════════════════════════════════

export interface SendNotificationResult {
  success: boolean;
  emailResult?: SendEmailResult;
  pushResult?: SendPushResult;
  logError?: string;
}

/**
 * Send a notification to a customer via the specified channel(s)
 * and log the delivery attempt to the notifications table.
 *
 * @param customerId  UUID of the customer (used for lookup + logging)
 * @param type        Notification type (e.g. 'subscription_reminder', 'pickup_ready')
 * @param channel     'push', 'email', or 'both'
 * @param title       Notification title (used for push; email subject)
 * @param body        Notification body (used for push; also email HTML body if no template)
 * @returns           Result with per-channel results
 */
export async function send_notification(
  customerId: string,
  type: string,
  channel: string,
  title: string,
  body: string,
): Promise<SendNotificationResult> {
  if (!customerId) {
    const msg = "customerId is required";
    log("error", msg);
    return { success: false };
  }

  // Look up customer information
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("email, name, push_token")
    .eq("id", customerId)
    .single();

  if (customerError || !customer) {
    const msg = `Failed to look up customer ${customerId}: ${customerError?.message ?? "not found"}`;
    log("error", msg);
    return { success: false };
  }

  let emailResult: SendEmailResult | undefined;
  let pushResult: SendPushResult | undefined;
  let effectiveChannel = channel;

  // Determine the actual channel based on available contact info
  if (channel === "both") {
    if (!customer.email && (!customer.push_token || !customer.push_token.trim())) {
      log("warn", `Customer ${customerId} has no email or push token — skipping both channels`);
      effectiveChannel = "none";
    } else if (!customer.email) {
      effectiveChannel = "push";
    } else if (!customer.push_token || !customer.push_token.trim()) {
      effectiveChannel = "email";
    }
  }

  // Send email
  if (effectiveChannel === "email" || effectiveChannel === "both") {
    if (customer.email) {
      emailResult = await send_email(customer.email, title, body);
    } else {
      log("warn", `Customer ${customerId} has no email — skipping email channel`);
    }
  }

  // Send push
  if (effectiveChannel === "push" || effectiveChannel === "both") {
    if (customer.push_token && customer.push_token.trim()) {
      pushResult = await send_push([customer.push_token], title, body);
    } else {
      log("warn", `Customer ${customerId} has no push token — skipping push channel`);
    }
  }

  // Log to notifications table. "delivered" means the customer was reached
  // via AT LEAST ONE channel — so an email that sent is not marked undelivered
  // just because push failed. Any channel failure is still recorded in `error`
  // (even when delivered=true) so push problems stay visible for monitoring.
  const emailOk = emailResult?.success === true;
  const pushOk = pushResult?.success === true;
  const delivered = emailOk || pushOk;
  const anyFailed =
    emailResult?.success === false || pushResult?.success === false;

  const { error: logError } = await supabase.from("notifications").insert({
    customer_id: customerId,
    type,
    channel: effectiveChannel === "none" ? channel : effectiveChannel,
    sent_at: new Date().toISOString(),
    delivered,
    error: anyFailed
      ? JSON.stringify({ email: emailResult?.error ?? null, push: pushResult?.error ?? null })
      : null,
  });

  if (logError) {
    log("error", `Failed to log notification for customer ${customerId}: ${logError.message}`);
  }

  const success = delivered;

  return {
    success,
    emailResult,
    pushResult,
    logError: logError?.message,
  };
}

// ═════════════════════════════════════════════════════════════
// 4. send_pickup_ready — Notify customers their orders are ready
// ═════════════════════════════════════════════════════════════

export interface PickupReadyResult {
  processed: number;
  errors: string[];
  results: Array<{
    orderId: string;
    success: boolean;
    customerEmail?: string;
    error?: string;
  }>;
}

/**
 * Send "pickup ready" notifications for one or more orders.
 *
 * For each order:
 *   1. Look up the order (with customer and pickup_location)
 *   2. Render the pickup_location's notification_template with placeholders
 *   3. Send push notification + email to the customer
 *   4. Log to the notifications table
 *
 * Placeholders:
 *   {ORDER_NUMBER}        — Last 8 characters of the order UUID (short identifier)
 *   {PICKUP_LOCATION}     — Name of the pickup location
 *   {CODE}                — Last 6 characters of the order UUID (pickup code)
 *   {EXTRA_TEXT}          — Optional extra text (unlock codes, instructions, etc.)
 *
 * @param orderIds    Array of order UUIDs to send pickup-ready notifications for
 * @param extraText   Optional text to append (e.g. unlock codes, special instructions)
 * @returns           Summary of results
 */
export async function send_pickup_ready(
  orderIds: string[],
  extraText?: string,
): Promise<PickupReadyResult> {
  if (!orderIds || orderIds.length === 0) {
    log("warn", "send_pickup_ready called with empty orderIds array");
    return { processed: 0, errors: [], results: [] };
  }

  const results: PickupReadyResult["results"] = [];
  const allErrors: string[] = [];

  for (const orderId of orderIds) {
    try {
      // 1. Look up the order with customer and pickup_location
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select(`
          id,
          customer_id,
          customer_email,
          customer_name,
          pickup_location_id,
          pickup_locations!inner (
            id,
            name,
            address,
            notification_template
          )
        `)
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        const msg = `Order ${orderId} not found: ${orderError?.message ?? "unknown error"}`;
        log("error", msg);
        results.push({ orderId, success: false, error: msg });
        allErrors.push(msg);
        continue;
      }

      // 2. Get the pickup location details
      const pickupLocation = order.pickup_locations as unknown as {
        id: string;
        name: string;
        address: string;
        notification_template: string | null;
      };

      const locationName = pickupLocation.name;
      let template = pickupLocation.notification_template ?? "";

      // 3. Generate short codes from order ID
      const orderNumber = orderId.substring(orderId.length - 8).toUpperCase();
      const code = orderId.substring(orderId.length - 6).toUpperCase();

      // 4. Render the template with placeholders
      if (!template) {
        // Fallback template if none is configured
        template = "Deine Bestellung {ORDER_NUMBER} ist abholbereit in {PICKUP_LOCATION}.";
      }

      const renderedBody = template
        .replace(/\{ORDER_NUMBER\}/g, orderNumber)
        .replace(/\{PICKUP_LOCATION\}/g, locationName)
        .replace(/\{CODE\}/g, code)
        .replace(/\{EXTRA_TEXT\}/g, extraText ?? "");

      // Append extraText if it wasn't used in template (e.g. if template has no {EXTRA_TEXT})
      const finalBody = extraText && !template.includes("{EXTRA_TEXT}")
        ? `${renderedBody}\n\n${extraText}`
        : renderedBody;

      // 5. Build a user-friendly HTML email
      const htmlBody = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Abholbereit</h2>
          <p>${renderedBody.replace(/\n/g, "<br>")}</p>
          <hr>
          <p style="color: #666; font-size: 0.9em;">
            <strong>${locationName}</strong><br>
            ${pickupLocation.address}
          </p>
          ${extraText ? `<p style="font-size: 1.1em; font-weight: bold;">${extraText}</p>` : ""}
          <p style="color: #999; font-size: 0.8em;">Smittenbrot – Handgemachtes Brot aus Stockdorf</p>
        </div>
      `.trim();

      const pushTitle = "Abholbereit";

      // 6. Look up customer for push token
      const { data: customer } = await supabase
        .from("customers")
        .select("email, push_token")
        .eq("id", order.customer_id)
        .single();

      // 7. Send push notification
      let pushResult: SendPushResult | undefined;
      if (customer?.push_token) {
        pushResult = await send_push(
          [customer.push_token],
          pushTitle,
          finalBody,
          { orderId, type: "pickup_ready" },
        );
      }

      // 8. Send email
      const recipientEmail = order.customer_email ?? customer?.email;
      let emailResult: SendEmailResult | undefined;
      if (recipientEmail) {
        emailResult = await send_email(
          recipientEmail,
          pushTitle,
          htmlBody,
        );
      }

      // 9. Log to notifications table
      const hasError =
        emailResult?.success === false || pushResult?.success === false;

      await supabase.from("notifications").insert({
        customer_id: order.customer_id,
        type: "pickup_ready",
        channel: pushResult && emailResult ? "both" : pushResult ? "push" : "email",
        sent_at: new Date().toISOString(),
        delivered: !hasError,
        error: hasError
          ? JSON.stringify({ email: emailResult?.error, push: pushResult?.error })
          : null,
      });

      results.push({
        orderId,
        success: !hasError,
        customerEmail: recipientEmail ?? undefined,
      });

      log(
        "info",
        `Pickup-ready notification sent for order ${orderId} (${orderNumber}) to ${recipientEmail ?? "N/A"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Unhandled error processing order ${orderId}: ${msg}`);
      results.push({ orderId, success: false, error: msg });
      allErrors.push(msg);
    }
  }

  const processed = results.filter((r) => r.success).length;

  log(
    "info",
    `send_pickup_ready completed: ${processed}/${orderIds.length} successful, ${allErrors.length} errors`,
  );

  return {
    processed,
    errors: allErrors,
    results,
  };
}

// ═════════════════════════════════════════════════════════════
// 5. send_admin_alert — Send an email alert to the admin
// ═════════════════════════════════════════════════════════════

export interface AdminAlertResult {
  success: boolean;
  error?: string;
}

/**
 * Send an alert email to the configured admin address.
 *
 * @param message  Plain-text message to include in the alert email
 * @returns        Result with success flag
 */
export async function send_admin_alert(message: string): Promise<AdminAlertResult> {
  if (!message) {
    log("warn", "send_admin_alert called with empty message");
    return { success: false, error: "Message is empty" };
  }

  const subject = "[Smittenbrot Admin Alert]";
  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Admin Alert</h2>
      <p style="font-size: 1.1em; background: #fff3cd; padding: 12px; border-radius: 4px;">
        ${message.replace(/\n/g, "<br>")}
      </p>
      <hr>
      <p style="color: #999; font-size: 0.8em;">
        Sent at: ${new Date().toISOString()}<br>
        Smittenbrot Notification Dispatch
      </p>
    </div>
  `.trim();

  log("info", `Sending admin alert: "${message.substring(0, 100)}..."`);

  const result = await send_email(ADMIN_EMAIL, subject, htmlBody);

  // Also log to notifications table as an admin_alert
  if (result.success) {
    await supabase.from("notifications").insert({
      customer_id: null,
      type: "admin_alert",
      channel: "email",
      sent_at: new Date().toISOString(),
      delivered: true,
    });
  }

  return {
    success: result.success,
    error: result.error,
  };
}

// ═════════════════════════════════════════════════════════════
// 6. send_order_receipt — Send German tax-compliant receipt to customer
// ═════════════════════════════════════════════════════════════

export interface SendReceiptResult {
  success: boolean;
  email?: string;
  error?: string;
  invoiceNumber?: string;
}

/**
 * Send a full German tax-compliant receipt (Rechnung) by email.
 *
 * Fetches order + items + products + seller_info and builds a complete
 * GoBD-compliant HTML invoice.
 *
 * @param orderId  UUID of the order to send receipt for
 * @returns        Result with success flag and optional error
 */
export async function send_order_receipt(orderId: string): Promise<SendReceiptResult> {
  if (!orderId) {
    return { success: false, error: "orderId is required" };
  }

  // ── Fetch order with items, products, seller info ──
  const { data: invoice, error: invoiceError } = await supabase
    .rpc("get_order_invoice", { p_order_id: orderId });

  if (invoiceError || !invoice) {
    const msg = `Failed to fetch invoice data for order ${orderId}: ${invoiceError?.message ?? "no data"}`;
    log("error", msg);
    return { success: false, error: msg };
  }

  const ord = invoice.order as Record<string, unknown>;
  const seller = invoice.seller as Record<string, unknown>;
  const items = invoice.items as Array<Record<string, unknown>>;

  const invoiceNumber = (ord.invoice_number as string) ?? orderId.substring(0, 8).toUpperCase();
  const customerName = (ord.customer_name as string) ?? "Kunde";
  const customerEmail = (ord.customer_email as string) ?? "";
  const fulfillmentDate = (ord.fulfillment_date as string) ?? "";
  const orderDate = (ord.order_date as string) ?? "";
  const paymentStatus = (ord.payment_status as string) ?? "";
  const status = (ord.status as string) ?? "";

  if (!customerEmail) {
    const msg = `Order ${orderId} has no customer email — cannot send receipt`;
    log("warn", msg);
    return { success: false, error: msg };
  }

  // ── Build item rows ──
  let itemsHtml = "";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    itemsHtml += `
      <tr>
        <td style="text-align: center; padding: 6px 4px; border-bottom: 1px solid #ddd;">${i + 1}</td>
        <td style="padding: 6px 4px; border-bottom: 1px solid #ddd;">${item.product_name ?? ""}</td>
        <td style="text-align: center; padding: 6px 4px; border-bottom: 1px solid #ddd;">${item.quantity ?? 0}</td>
        <td style="text-align: right; padding: 6px 4px; border-bottom: 1px solid #ddd;">€${((item.unit_price_gross as number ?? 0) / 100).toFixed(2)}</td>
        <td style="text-align: right; padding: 6px 4px; border-bottom: 1px solid #ddd;">€${((item.unit_price_net as number ?? 0) / 100).toFixed(2)}</td>
        <td style="text-align: center; padding: 6px 4px; border-bottom: 1px solid #ddd;">${((item.vat_rate as number ?? 0) * 100).toFixed(0)}%</td>
        <td style="text-align: right; padding: 6px 4px; border-bottom: 1px solid #ddd;">€${((item.vat_cents as number ?? 0) * (item.quantity as number ?? 1) / 100).toFixed(2)}</td>
        <td style="text-align: right; padding: 6px 4px; border-bottom: 1px solid #ddd;">€${((item.line_total_gross as number ?? 0) / 100).toFixed(2)}</td>
      </tr>`;
  }

  // ── Build the full HTML email ──
  const taxId = (seller.tax_id as string) ?? "";
  const vatId = (seller.vat_id as string) ?? "";

  const paymentStatusLabel: Record<string, string> = {
    paid: "Bezahlt",
    pending: "Ausstehend",
    failed: "Fehlgeschlagen",
    refunded: "Rückerstattet",
  };

  const htmlBody = `
    <div style="font-family: 'Helvetica', 'Arial', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333;">
      <div style="border-bottom: 3px solid #1A1A1A; padding-bottom: 10px; margin-bottom: 20px;">
        <h1 style="color: #1A1A1A; font-size: 24px; margin: 0;">Smittenbrot</h1>
        <p style="margin: 4px 0 0; color: #666; font-size: 13px;">Handgemachtes Sauerteigbrot aus Stockdorf</p>
      </div>

      <h2 style="font-size: 18px; color: #1A1A1A;">Rechnung ${invoiceNumber}</h2>

      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 10px;">
            <div style="background: #F5EDE0; padding: 10px; border-radius: 6px;">
              <strong style="font-size: 12px; color: #666;">Verkäufer</strong>
              <p style="margin: 4px 0; font-size: 13px;">
                ${seller.name ?? "Smittenbrot"}<br>
                ${seller.address_line1 ?? ""}${seller.address_line2 ? "<br>" + seller.address_line2 : ""}<br>
                ${seller.postal_code ?? ""} ${seller.city ?? ""}<br>
                ${seller.country ?? "Deutschland"}<br>
                ${taxId ? `<br>Steuer-Nr.: ${taxId}` : ""}
                ${vatId ? `<br>USt-IdNr.: ${vatId}` : ""}
              </p>
            </div>
          </td>
          <td style="width: 50%; vertical-align: top; padding-left: 10px;">
            <div style="background: #F5EDE0; padding: 10px; border-radius: 6px;">
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
          <td style="padding: 2px 0; text-align: right;">${new Date(orderDate).toLocaleDateString("de-DE")}</td>
        </tr>
        <tr>
          <td style="padding: 2px 0; color: #666;">Leistungsdatum (Abholung):</td>
          <td style="padding: 2px 0; text-align: right;">${new Date(fulfillmentDate + "T12:00:00").toLocaleDateString("de-DE")}</td>
        </tr>
        <tr>
          <td style="padding: 2px 0; color: #666;">Zahlungsstatus:</td>
          <td style="padding: 2px 0; text-align: right;">${paymentStatusLabel[paymentStatus] ?? paymentStatus}</td>
        </tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 12px;">
        <thead>
          <tr style="background: #1A1A1A; color: white;">
            <th style="padding: 8px 4px; text-align: center;">Pos.</th>
            <th style="padding: 8px 4px; text-align: left;">Produkt</th>
            <th style="padding: 8px 4px; text-align: center;">Menge</th>
            <th style="padding: 8px 4px; text-align: right;">Preis (brutto)</th>
            <th style="padding: 8px 4px; text-align: right;">Netto</th>
            <th style="padding: 8px 4px; text-align: center;">MwSt.</th>
            <th style="padding: 8px 4px; text-align: right;">MwSt.-Betrag</th>
            <th style="padding: 8px 4px; text-align: right;">Gesamt (brutto)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div style="border-top: 2px solid #1A1A1A; padding-top: 10px; margin-top: 5px; text-align: right; font-size: 13px;">
        <p style="margin: 2px 0;">Nettobetrag: <strong>€${((ord.total_net as number ?? 0) / 100).toFixed(2)}</strong></p>
        <p style="margin: 2px 0;">Enthaltene MwSt. 7%: <strong>€${((ord.total_vat as number ?? 0) / 100).toFixed(2)}</strong></p>
        <p style="margin: 2px 0; font-size: 16px; color: #1A1A1A;">Rechnungsbetrag (brutto): <strong>€${((ord.total_gross as number ?? 0) / 100).toFixed(2)}</strong></p>
      </div>

      <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

      <p style="font-size: 11px; color: #999; text-align: center;">
        Smittenbrot · ${seller.address_line1 ?? ""} · ${seller.postal_code ?? ""} ${seller.city ?? ""}<br>
        ${taxId ? `Steuer-Nr.: ${taxId} · ` : ""}E-Mail: ${seller.email ?? "info@smittenbrot.de"}<br>
        Zahlung erfolgt über Stripe
      </p>
    </div>
  `.trim();

  // ── Send the email ──
  const subject = `Deine Smittenbrot Rechnung ${invoiceNumber}`;
  const result = await send_email(customerEmail, subject, htmlBody);

  if (result.success) {
    log("info", `Receipt ${invoiceNumber} sent to ${customerEmail} for order ${orderId}`);

    // Log to notifications table
    await supabase.from("notifications").insert({
      customer_id: null,
      type: "order_placed",
      channel: "email",
      sent_at: new Date().toISOString(),
      delivered: true,
    });
  }

  return {
    success: result.success,
    email: customerEmail,
    error: result.error,
    invoiceNumber,
  };
}

// ═════════════════════════════════════════════════════════════
// HTTP Router — makes the functions above invocable over HTTP.
// Server-to-server only; callers authenticate with the service-role
// key (verify_jwt stays enabled for this function).
// ═════════════════════════════════════════════════════════════

/** Format an ISO date (YYYY-MM-DD) as DD.MM.YYYY for German copy. */
function formatDe(dateStr: unknown): string {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return typeof dateStr === "string" ? dateStr : "";
  }
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Default German copy per notification type. Callers (e.g. the
 * subscription engine) can POST just { customer_id, type, channel, data }
 * and the correct title/body is rendered here, keeping notification
 * wording in a single place. An explicit title/body overrides the template.
 */
const NOTIFICATION_TEMPLATES: Record<
  string,
  (data: Record<string, unknown>) => { title: string; body: string }
> = {
  subscription_reminder: (d) => {
    const text =
      `Dein Smittenbrot-Abo wird heute um 20:00 Uhr als Bestellung` +
      `${d.fulfillment_date ? ` für ${formatDe(d.fulfillment_date)}` : ""} aufgegeben. ` +
      `Änderungen oder Stornierung sind bis 22:00 Uhr möglich.`;
    // This week's items (already A/B-filtered by the engine) so the customer
    // knows exactly what's coming — important for bi-weekly breads.
    const list = Array.isArray(d.items) ? (d.items as { name: string; quantity: number }[]) : [];
    const itemsHtml = list.length
      ? `<p style="margin:16px 0 4px;font-weight:600">Diese Woche dabei:</p><ul style="margin:0;padding-left:20px">` +
        list.map((i) => `<li>${i.quantity}× ${i.name}</li>`).join("") +
        `</ul>`
      : "";
    // EU opt-out: reminder emails carry an unsubscribe link (unguessable token).
    // Transactional mails (invoice, order, cancellation) intentionally do NOT.
    const unsub =
      d.customer_id && d.unsubscribe_token
        ? `<p style="margin-top:24px;font-size:12px;color:#6B7280">` +
          `Keine Bestell-Erinnerungen mehr? ` +
          `<a href="${SITE_URL}/abmelden?c=${d.customer_id}&t=${d.unsubscribe_token}" style="color:#6B7280;text-decoration:underline">Hier abmelden</a>.` +
          `</p>`
        : "";
    return {
      title: "Deine Abo-Bestellung wird heute Abend aufgegeben",
      body: `<p style="margin:0">${text}</p>${itemsHtml}${unsub}`,
    };
  },
  order_placed: (d) => ({
    title: "Deine Abo-Bestellung wurde aufgegeben",
    body:
      `Deine Bestellung${d.fulfillment_date ? ` für ${formatDe(d.fulfillment_date)}` : ""} ` +
      `wurde aufgegeben. Du kannst sie bis 22:00 Uhr noch ändern oder stornieren.`,
  }),
  payment_failed: () => ({
    title: "Zahlung fehlgeschlagen",
    body:
      "Die Zahlung für deine Smittenbrot-Bestellung ist fehlgeschlagen. " +
      "Bitte aktualisiere deine Zahlungsmethode in der App.",
  }),
  subscription_cancelled: () => ({
    title: "Abonnement gekündigt",
    body:
      "Dein Smittenbrot-Abonnement wurde gekündigt. Du kannst jederzeit " +
      "ein neues Abo starten.",
  }),
  subscription_paused: (d) => ({
    title: "Abonnement pausiert",
    body: d.resume_date
      ? `Dein Abo ist bis ${formatDe(d.resume_date)} pausiert und wird danach automatisch fortgesetzt.`
      : "Dein Abo ist pausiert.",
  }),
  closure_notice: () => ({
    title: "Backpause bei Smittenbrot",
    body:
      "Während unserer Schließzeit findet keine Produktion statt. " +
      "Betroffene Abos werden automatisch pausiert und danach fortgesetzt.",
  }),
};

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const action = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    switch (action) {
      case "send-notification": {
        const customerId = (body.customer_id as string) ?? "";
        const type = (body.type as string) ?? "";
        const channel = (body.channel as string) ?? "both";
        if (!customerId) {
          return jsonResponse({ error: "customer_id is required" }, 400);
        }
        let title = body.title as string | undefined;
        let text = body.body as string | undefined;
        if ((!title || !text) && NOTIFICATION_TEMPLATES[type]) {
          const rendered = NOTIFICATION_TEMPLATES[type](
            (body.data as Record<string, unknown>) ?? {},
          );
          title = title ?? rendered.title;
          text = text ?? rendered.body;
        }
        const result = await send_notification(
          customerId,
          type,
          channel,
          title ?? "Smittenbrot",
          text ?? "",
        );
        return jsonResponse(result, result.success ? 200 : 502);
      }

      case "send-pickup-ready": {
        const orderIds = Array.isArray(body.order_ids)
          ? (body.order_ids as string[])
          : body.order_id
          ? [body.order_id as string]
          : [];
        if (orderIds.length === 0) {
          return jsonResponse(
            { error: "order_ids (or order_id) is required" },
            400,
          );
        }
        const result = await send_pickup_ready(
          orderIds,
          body.extra_text as string | undefined,
        );
        return jsonResponse(result);
      }

      case "send-admin-alert": {
        const message = (body.message as string) ?? "";
        if (!message) {
          return jsonResponse({ error: "message is required" }, 400);
        }
        const result = await send_admin_alert(message);
        return jsonResponse(result, result.success ? 200 : 502);
      }

      case "send-order-receipt": {
        const orderId = (body.order_id as string) ?? "";
        if (!orderId) {
          return jsonResponse({ error: "order_id is required" }, 400);
        }
        const result = await send_order_receipt(orderId);
        return jsonResponse(result, result.success ? 200 : 502);
      }

      default:
        return jsonResponse(
          {
            error: `Unknown action: ${action}`,
            available_actions: [
              "send-notification",
              "send-pickup-ready",
              "send-admin-alert",
              "send-order-receipt",
            ],
          },
          404,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    log("error", `Router error on action "${action}": ${msg}`);
    return jsonResponse({ error: msg }, 500);
  }
});
