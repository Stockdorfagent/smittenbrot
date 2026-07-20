// ============================================================
// Smittenbrot — Capacity Manager Edge Function
// ============================================================
// Handles capacity checking, reservation validation, and
// subscription capacity pre-allocation.
//
// Routes (all POST):
//   /check-capacity           - Check available capacity for a product on a date
//   /reserve-capacity         - Check if capacity is available for an order
//   /subscription-reservation - Calculate capacity consumed by subscriptions
//   /capacity-impact-preview  - Preview impact of changing product capacity
//
// Capacity is per product per production day (Wednesday or Saturday).
// All pickup locations share one capacity pool.
// Subscriptions reserve capacity first; one-time orders use remaining.
// Time zone: Europe/Berlin
// ============================================================

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

// ── Environment Variables ────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Clients ──────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ── Constants ────────────────────────────────────────────────

const TIMEZONE = "Europe/Berlin";

// Order statuses that are NOT counted toward reserved capacity
const EXCLUDED_STATUSES: string[] = ["cancelled", "refunded"];

// ── Types ────────────────────────────────────────────────────

interface CheckCapacityRequest {
  fulfillment_date: string;
  product_id: string;
}

interface ReserveCapacityRequest {
  product_id: string;
  fulfillment_date: string;
  quantity: number;
}

interface SubscriptionReservationRequest {
  fulfillment_date: string;
  product_id?: string;
}

interface CapacityImpactPreviewRequest {
  product_id: string;
  new_capacity: number;
}

// ── Logging ──────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const tag = "[capacity-manager]";
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

/**
 * Return a JSON response with the given status code and body.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Return a 400 Bad Request error response.
 */
function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

/**
 * Return a 404 Not Found error response.
 */
function notFound(message: string): Response {
  return jsonResponse({ error: message }, 404);
}

/**
 * Return a 500 Internal Server Error response.
 */
function serverError(message: string): Response {
  log("error", message);
  return jsonResponse({ error: "Internal server error" }, 500);
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get the day of week (0=Sunday, 1=Monday, ..., 6=Saturday) for a
 * given date string in Europe/Berlin timezone.
 */
function getDayOfWeek(dateStr: string): number {
  const date = new Date(dateStr + "T12:00:00+02:00");
  return date.getDay();
}

/**
 * Determine if a date string corresponds to a Wednesday (day 3) or
 * Saturday (day 6). Returns the day column name ('available_wed' or
 * 'available_sat'), or null if the date is neither a Wednesday nor
 * a Saturday.
 */
function getProductionDayColumn(dateStr: string): "available_wed" | "available_sat" | null {
  const dow = getDayOfWeek(dateStr);
  if (dow === 3) return "available_wed";
  if (dow === 6) return "available_sat";
  return null;
}

/**
 * Get the current week type (A or B) from the week_cycle table.
 */
async function getCurrentWeekType(): Promise<"A" | "B"> {
  const { data, error } = await supabase
    .from("week_cycle")
    .select("current_week")
    .limit(1)
    .single();

  if (error || !data) {
    log("error", "Failed to get week cycle:", error);
    return "A";
  }

  return data.current_week as "A" | "B";
}

/**
 * Fetch a product by ID. Returns the product row or null.
 */
async function getProduct(productId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Calculate the total reserved quantity for a product on a given
 * fulfillment date, ENFORCING the "subscriptions reserve first" rule.
 *
 * reserved = materialized orders (one-time + already-placed subscription
 *            orders, non-cancelled/refunded)
 *          + projected demand from active subscriptions that do NOT yet
 *            have a materialized order for this date
 *
 * The exclusion of already-materialized subscriptions prevents double
 * counting: before the 20:00 run a subscription contributes projected
 * demand; after it, the same demand is a real order row instead.
 */
async function getReservedCount(
  productId: string,
  fulfillmentDate: string,
): Promise<number> {
  // Step 1: Get all valid (non-cancelled, non-refunded) orders for the date,
  // keeping subscription_id so we can tell which subscriptions are already
  // materialized into orders for this date.
  const { data: validOrders, error: ordersError } = await supabase
    .from("orders")
    .select("id, subscription_id")
    .eq("fulfillment_date", fulfillmentDate)
    .not("status", "in", `(${EXCLUDED_STATUSES.map((s) => `"${s}"`).join(",")})`);

  if (ordersError) {
    log("error", "Failed to fetch valid orders:", ordersError);
    return 0;
  }

  const orders = validOrders ?? [];

  // Step 2: Sum quantities from order_items for the product within those orders
  let materializedQty = 0;
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("quantity")
      .eq("product_id", productId)
      .in("order_id", orderIds);

    if (itemsError) {
      log("error", "Failed to fetch order items:", itemsError);
      return 0;
    }

    materializedQty = (items ?? []).reduce(
      (sum, item) => sum + (item.quantity ?? 0),
      0,
    );
  }

  // Step 3: Add projected demand from active subscriptions that do NOT yet
  // have a materialized order for this date (their demand is not in
  // materializedQty). Subscriptions already materialized are excluded to
  // avoid double counting.
  const subIdsWithOrder = new Set(
    orders
      .filter((o) => o.subscription_id)
      .map((o) => o.subscription_id as string),
  );

  const projectedSubscriptionQty = await getSubscriptionReservedCount(
    productId,
    fulfillmentDate,
    subIdsWithOrder,
  );

  return materializedQty + projectedSubscriptionQty;
}

/**
 * Calculate the capacity reserved by subscriptions for a product on
 * a given fulfillment date.
 *
 * This accounts for:
 *   - Active subscriptions (not paused, not cancelled)
 *   - Subscription items matching the product
 *   - Product availability on the production day (available_wed/available_sat)
 *   - Week cycle matching (permanent always, week_a only in A, week_b only in B)
 *
 * Returns the total quantity from subscription_items that would be
 * consumed on that fulfillment date.
 */
async function getSubscriptionReservedCount(
  productId: string,
  fulfillmentDate: string,
  excludeSubscriptionIds?: Set<string>,
): Promise<number> {
  const productionDayColumn = getProductionDayColumn(fulfillmentDate);
  if (!productionDayColumn) {
    log("warn", `Date ${fulfillmentDate} is neither a Wednesday nor a Saturday`);
    return 0;
  }

  const currentWeek = await getCurrentWeekType();

  // Get active subscriptions (status = 'active' and not paused for this date)
  const { data: activeSubscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("status", "active")
    .or(`paused_until.is.null,paused_until.lt.${fulfillmentDate}`);

  if (subError) {
    log("error", "Failed to fetch active subscriptions:", subError);
    return 0;
  }

  if (!activeSubscriptions || activeSubscriptions.length === 0) {
    return 0;
  }

  const subscriptionIds = activeSubscriptions
    .map((s) => s.id)
    .filter((id) => !excludeSubscriptionIds?.has(id));

  if (subscriptionIds.length === 0) {
    return 0;
  }

  // Get subscription_items joined with products, filtered by product_id
  const { data: items, error: itemsError } = await supabase
    .from("subscription_items")
    .select(`
      quantity,
      products!inner (
        id,
        cycle,
        available_wed,
        available_sat
      )
    `)
    .eq("product_id", productId)
    .in("subscription_id", subscriptionIds);

  if (itemsError) {
    log("error", "Failed to fetch subscription items:", itemsError);
    return 0;
  }

  if (!items || items.length === 0) {
    return 0;
  }

  // Filter items by product availability and week cycle
  let total = 0;
  for (const item of items) {
    const product = item.products as unknown as {
      id: string;
      cycle: string;
      available_wed: boolean;
      available_sat: boolean;
    };

    // Check product availability on this production day
    const availableOnDay = productionDayColumn === "available_wed"
      ? product.available_wed
      : product.available_sat;

    if (!availableOnDay) {
      continue;
    }

    // Check week cycle match
    const cycle = product.cycle;
    if (cycle === "hidden") {
      continue;
    }
    if (cycle === "week_a" && currentWeek !== "A") {
      continue;
    }
    if (cycle === "week_b" && currentWeek !== "B") {
      continue;
    }
    // 'permanent' always matches

    total += item.quantity ?? 0;
  }

  return total;
}

/**
 * Get the capacity for a product. Returns the max_capacity from the
 * products table, or null if the product doesn't exist.
 */
async function getMaxCapacity(productId: string): Promise<number | null> {
  const product = await getProduct(productId);
  if (!product) return null;
  return product.capacity as number;
}

// ═════════════════════════════════════════════════════════════
// Route Handlers
// ═════════════════════════════════════════════════════════════

/**
 * POST /check-capacity
 *
 * Given a fulfillment_date and product_id, returns:
 *   { max_capacity, reserved_count, available_count }
 *
 * - reserved_count = sum of quantities in orders with status NOT IN
 *   ('cancelled', 'refunded') for that product on that fulfillment_date.
 * - If fulfillment_date is a Wednesday, only counts Wednesday orders.
 *   Same for Saturday.
 */
async function handleCheckCapacity(body: CheckCapacityRequest): Promise<Response> {
  const { fulfillment_date, product_id } = body;

  if (!fulfillment_date || !product_id) {
    return badRequest("Missing required fields: fulfillment_date, product_id");
  }

  // Validate the date is a production day
  const productionDay = getProductionDayColumn(fulfillment_date);
  if (!productionDay) {
    return badRequest(
      `Invalid fulfillment_date "${fulfillment_date}": must be a Wednesday or Saturday`,
    );
  }

  // Validate product exists
  const maxCapacity = await getMaxCapacity(product_id);
  if (maxCapacity === null) {
    return notFound(`Product "${product_id}" not found`);
  }

  // Validate product is available on this production day
  const product = await getProduct(product_id);
  if (product) {
    const available = productionDay === "available_wed"
      ? product.available_wed
      : product.available_sat;
    if (!available) {
      return jsonResponse({
        max_capacity: maxCapacity,
        reserved_count: 0,
        available_count: 0,
        message: "Produkt an diesem Tag nicht verfügbar",
      });
    }
  }

  const reservedCount = await getReservedCount(product_id, fulfillment_date);
  const availableCount = Math.max(0, maxCapacity - reservedCount);

  log("info", `check-capacity: product=${product_id} date=${fulfillment_date} ` +
    `max=${maxCapacity} reserved=${reservedCount} available=${availableCount}`);

  return jsonResponse({
    max_capacity: maxCapacity,
    reserved_count: reservedCount,
    available_count: availableCount,
  });
}

/**
 * POST /reserve-capacity
 *
 * Called when placing an order. Given product_id, fulfillment_date, quantity:
 *   - Checks if enough capacity remaining
 *   - If yes: returns { available: true }
 *   - If no:  returns { available: false, available_count, message: "Ausverkauft" }
 */
async function handleReserveCapacity(body: ReserveCapacityRequest): Promise<Response> {
  const { product_id, fulfillment_date, quantity } = body;

  if (!product_id || !fulfillment_date || quantity === undefined || quantity === null) {
    return badRequest("Missing required fields: product_id, fulfillment_date, quantity");
  }

  if (typeof quantity !== "number" || quantity <= 0 || !Number.isInteger(quantity)) {
    return badRequest("quantity must be a positive integer");
  }

  // Validate the date is a production day
  const productionDay = getProductionDayColumn(fulfillment_date);
  if (!productionDay) {
    return badRequest(
      `Invalid fulfillment_date "${fulfillment_date}": must be a Wednesday or Saturday`,
    );
  }

  // Validate product exists
  const maxCapacity = await getMaxCapacity(product_id);
  if (maxCapacity === null) {
    return notFound(`Product "${product_id}" not found`);
  }

  // Validate product is available on this production day
  const product = await getProduct(product_id);
  if (product) {
    const available = productionDay === "available_wed"
      ? product.available_wed
      : product.available_sat;
    if (!available) {
      return jsonResponse({
        available: false,
        available_count: 0,
        message: "Ausverkauft",
      });
    }
  }

  const reservedCount = await getReservedCount(product_id, fulfillment_date);
  const availableCount = Math.max(0, maxCapacity - reservedCount);

  log("info", `reserve-capacity: product=${product_id} date=${fulfillment_date} ` +
    `qty=${quantity} max=${maxCapacity} reserved=${reservedCount} available=${availableCount}`);

  if (quantity <= availableCount) {
    return jsonResponse({ available: true });
  }

  return jsonResponse({
    available: false,
    available_count: availableCount,
    message: "Ausverkauft",
  });
}

/**
 * POST /subscription-reservation
 *
 * Calculate how much capacity subscriptions will consume for a given
 * fulfillment_date before one-time orders can be placed.
 *
 * If product_id is provided, returns subscription reservation for
 * that specific product. Otherwise returns for all products that
 * have active subscription items.
 *
 * Used by the shop display to show accurate availability.
 */
async function handleSubscriptionReservation(
  body: SubscriptionReservationRequest,
): Promise<Response> {
  const { fulfillment_date, product_id } = body;

  if (!fulfillment_date) {
    return badRequest("Missing required field: fulfillment_date");
  }

  // Validate the date is a production day
  const productionDay = getProductionDayColumn(fulfillment_date);
  if (!productionDay) {
    return badRequest(
      `Invalid fulfillment_date "${fulfillment_date}": must be a Wednesday or Saturday`,
    );
  }

  const currentWeek = await getCurrentWeekType();

  // Get active subscriptions (status = 'active' and not paused)
  const { data: activeSubscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("status", "active")
    .or(`paused_until.is.null,paused_until.lt.${fulfillment_date}`);

  if (subError) {
    log("error", "Failed to fetch active subscriptions:", subError);
    return serverError("Failed to fetch active subscriptions");
  }

  if (!activeSubscriptions || activeSubscriptions.length === 0) {
    if (product_id) {
      return jsonResponse({
        fulfillment_date,
        product_id,
        subscription_reserved: 0,
      });
    }
    return jsonResponse({
      fulfillment_date,
      product_reservations: [],
    });
  }

  const subscriptionIds = activeSubscriptions.map((s) => s.id);

  // Build the query for subscription_items
  let query = supabase
    .from("subscription_items")
    .select(`
      product_id,
      quantity,
      products!inner (
        id,
        cycle,
        available_wed,
        available_sat,
        capacity
      )
    `)
    .in("subscription_id", subscriptionIds);

  if (product_id) {
    query = query.eq("product_id", product_id);
  }

  const { data: items, error: itemsError } = await query;

  if (itemsError) {
    log("error", "Failed to fetch subscription items:", itemsError);
    return serverError("Failed to fetch subscription items");
  }

  if (!items || items.length === 0) {
    if (product_id) {
      return jsonResponse({
        fulfillment_date,
        product_id,
        subscription_reserved: 0,
      });
    }
    return jsonResponse({
      fulfillment_date,
      product_reservations: [],
    });
  }

  // Aggregate subscription quantities per product, filtering by availability
  const productReservations: Record<string, { product_id: string; product_name?: string; subscription_reserved: number; max_capacity: number }> = {};

  for (const item of items) {
    const product = item.products as unknown as {
      id: string;
      cycle: string;
      available_wed: boolean;
      available_sat: boolean;
      capacity: number;
    };

    // Check product availability on this production day
    const availableOnDay = productionDay === "available_wed"
      ? product.available_wed
      : product.available_sat;

    if (!availableOnDay) {
      continue;
    }

    // Check week cycle match
    const cycle = product.cycle;
    if (cycle === "hidden") continue;
    if (cycle === "week_a" && currentWeek !== "A") continue;
    if (cycle === "week_b" && currentWeek !== "B") continue;

    const pid = item.product_id;
    if (!productReservations[pid]) {
      productReservations[pid] = {
        product_id: pid,
        product_name: (product as unknown as { name?: string }).name ?? undefined,
        subscription_reserved: 0,
        max_capacity: product.capacity,
      };
    }

    productReservations[pid].subscription_reserved += item.quantity ?? 0;
  }

  const reservations = Object.values(productReservations);

  if (product_id) {
    const found = reservations.find((r) => r.product_id === product_id);
    if (found) {
      return jsonResponse({
        fulfillment_date,
        product_id,
        subscription_reserved: found.subscription_reserved,
        max_capacity: found.max_capacity,
      });
    }
    // Product not found in active subscriptions
    const product = await getProduct(product_id);
    return jsonResponse({
      fulfillment_date,
      product_id,
      subscription_reserved: 0,
      max_capacity: product?.capacity ?? 0,
    });
  }

  return jsonResponse({
    fulfillment_date,
    product_reservations: reservations,
  });
}

/**
 * POST /capacity-impact-preview
 *
 * Given a product_id with a new_capacity value, return how many existing
 * orders would be affected (i.e., would exceed the new capacity).
 *
 * Affected orders are those with status NOT IN ('cancelled', 'refunded')
 * that, combined with subscription reservations, would exceed new_capacity.
 */
async function handleCapacityImpactPreview(
  body: CapacityImpactPreviewRequest,
): Promise<Response> {
  const { product_id, new_capacity } = body;

  if (!product_id || new_capacity === undefined || new_capacity === null) {
    return badRequest("Missing required fields: product_id, new_capacity");
  }

  if (typeof new_capacity !== "number" || new_capacity < 0 || !Number.isInteger(new_capacity)) {
    return badRequest("new_capacity must be a non-negative integer");
  }

  // Validate product exists
  const product = await getProduct(product_id);
  if (!product) {
    return notFound(`Product "${product_id}" not found`);
  }

  const oldCapacity = product.capacity as number;

  // If capacity is being increased, no orders are negatively affected
  if (new_capacity >= oldCapacity) {
    return jsonResponse({
      product_id,
      old_capacity: oldCapacity,
      new_capacity,
      capacity_increased: true,
      affected_upcoming_dates: [],
      total_affected_orders: 0,
      total_affected_subscription_items: 0,
    });
  }

  // Capacity is being reduced. Find all future fulfillment dates with
  // orders or subscription items that might be affected.
  const today = new Date().toISOString().split("T")[0];

  // Get all upcoming fulfillment dates that have orders for this product
  const { data: upcomingOrders, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id,
      fulfillment_date,
      order_type,
      status,
      order_items!inner (
        quantity
      )
    `)
    .eq("order_items.product_id", product_id)
    .gte("fulfillment_date", today)
    .not("status", "in", `(${EXCLUDED_STATUSES.map((s) => `"${s}"`).join(",")})`);

  if (ordersError) {
    log("error", "Failed to fetch upcoming orders:", ordersError);
    return serverError("Failed to fetch upcoming orders");
  }

  // Get active subscriptions that include this product
  const currentWeek = await getCurrentWeekType();
  const { data: activeSubs, error: subError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("status", "active")
    .or(`paused_until.is.null,paused_until.lt.${today}`);

  if (subError) {
    log("error", "Failed to fetch active subscriptions:", subError);
    return serverError("Failed to fetch active subscriptions");
  }

  let totalSubscriptionQty = 0;
  if (activeSubs && activeSubs.length > 0) {
    const subIds = activeSubs.map((s) => s.id);
    const { data: subItems, error: subItemsError } = await supabase
      .from("subscription_items")
      .select(`
        quantity,
        products!inner (
          cycle,
          available_wed,
          available_sat
        )
      `)
      .eq("product_id", product_id)
      .in("subscription_id", subIds);

    if (subItemsError) {
      log("error", "Failed to fetch subscription items for impact:", subItemsError);
    } else if (subItems) {
      for (const item of subItems) {
        const p = item.products as unknown as {
          cycle: string;
          available_wed: boolean;
          available_sat: boolean;
        };
        if (p.cycle === "hidden") continue;
        if (p.cycle === "week_a" && currentWeek !== "A") continue;
        if (p.cycle === "week_b" && currentWeek !== "B") continue;
        totalSubscriptionQty += item.quantity ?? 0;
      }
    }
  }

  // Analyze each upcoming fulfillment date
  const affectedDates = new Map<string, { date: string; total_ordered: number; exceeded_by: number }>();

  if (upcomingOrders) {
    for (const order of upcomingOrders) {
      const date = order.fulfillment_date;
      const orderQty = (order.order_items as unknown as Array<{ quantity: number }>)
        .reduce((sum, oi) => sum + (oi.quantity ?? 0), 0);

      if (!affectedDates.has(date)) {
        affectedDates.set(date, { date, total_ordered: 0, exceeded_by: 0 });
      }
      affectedDates.get(date)!.total_ordered += orderQty;
    }
  }

  // For each affected date, calculate if we exceed new_capacity
  // (accounting for subscription reservations on that day)
  const affectedUpcomingDates: Array<{
    fulfillment_date: string;
    existing_orders_quantity: number;
    subscription_quantity_estimate: number;
    new_capacity: number;
    exceeded_by: number;
  }> = [];

  for (const [, entry] of affectedDates) {
    // Estimate subscription reservation for this date — we use the
    // active subscription items count as an approximation since we
    // don't know the exact week cycle for each future date.
    const subscriptionShare = totalSubscriptionQty; // approximation
    const totalDemand = entry.total_ordered + subscriptionShare;
    const exceededBy = Math.max(0, totalDemand - new_capacity);

    if (exceededBy > 0) {
      affectedUpcomingDates.push({
        fulfillment_date: entry.date,
        existing_orders_quantity: entry.total_ordered,
        subscription_quantity_estimate: subscriptionShare,
        new_capacity,
        exceeded_by: exceededBy,
      });
    }
  }

  // Sort by date
  affectedUpcomingDates.sort(
    (a, b) => a.fulfillment_date.localeCompare(b.fulfillment_date),
  );

  const totalAffectedOrders = (upcomingOrders ?? []).length;

  log("info", `capacity-impact-preview: product=${product_id} ` +
    `old=${oldCapacity} new=${new_capacity} ` +
    `affectedDates=${affectedUpcomingDates.length} ` +
    `affectedOrders=${totalAffectedOrders} ` +
    `subscriptionItems=${totalSubscriptionQty}`);

  return jsonResponse({
    product_id,
    product_name: (product as unknown as { name?: string })?.name ?? "",
    old_capacity: oldCapacity,
    new_capacity,
    capacity_increased: false,
    affected_upcoming_dates: affectedUpcomingDates,
    total_affected_orders: totalAffectedOrders,
    total_affected_subscription_quantity: totalSubscriptionQty,
  });
}

// ═════════════════════════════════════════════════════════════
// Request Router
// ═════════════════════════════════════════════════════════════

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, ""); // strip trailing slash
  // Supabase includes the function name in the path
  // (e.g. "/capacity-manager/check-capacity"), so route on the LAST segment.
  const action = path.split("/").pop() ?? "";

  log("info", `Incoming request: ${req.method} ${path} (action=${action})`);

  // Only accept POST requests for all routes
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  // Route on the last path segment
  switch (action) {
    case "check-capacity":
      return await handleCheckCapacity(body as unknown as CheckCapacityRequest);

    case "reserve-capacity":
      return await handleReserveCapacity(body as unknown as ReserveCapacityRequest);

    case "subscription-reservation":
      return await handleSubscriptionReservation(
        body as unknown as SubscriptionReservationRequest,
      );

    case "capacity-impact-preview":
      return await handleCapacityImpactPreview(
        body as unknown as CapacityImpactPreviewRequest,
      );

    default:
      return jsonResponse({ error: `Not found: ${path}` }, 404);
  }
}

// ── Serve ────────────────────────────────────────────────────

serve(handleRequest);
