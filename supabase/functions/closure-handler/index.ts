// ============================================================
// Smittenbrot — Closure Handler Edge Function
// ============================================================
// Handles bakery closures: create (auto-pause subscriptions),
// delete (auto-resume subscriptions), and active check for
// banners/blocking.
//
// Routes (all POST):
//   /create  - Create a new closure, pause active subscriptions
//   /delete  - Delete a closure, resume affected subscriptions
//   /active  - Check if there's an active closure right now
//
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

// ── Types ────────────────────────────────────────────────────

interface CreateClosureRequest {
  start_date: string;
  end_date: string;
  reason?: string;
  banner_text_de?: string;
}

interface DeleteClosureRequest {
  closure_id: string;
}

// ── Logging ──────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const tag = "[closure-handler]";
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

// ── Date Helpers ─────────────────────────────────────────────

/**
 * Get the current date string (YYYY-MM-DD) in Europe/Berlin timezone.
 */
function todayInTz(): string {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

/**
 * Add N days to a date string (YYYY-MM-DD) and return a new date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00+02:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ═════════════════════════════════════════════════════════════
// Route Handlers
// ═════════════════════════════════════════════════════════════

/**
 * POST /create
 *
 * Create a new bakery closure. Given start_date and end_date (with optional
 * reason and banner_text_de), this will:
 *   1. Insert a new closure record
 *   2. Find all active subscriptions (status = 'active') that are not already
 *      paused through a future date, and set paused_until = end_date + 1 day
 *   3. Create notification records of type 'closure_notice' for each affected
 *      subscriber
 *
 * Returns { closure_id, subscriptions_paused: N }.
 */
async function handleCreate(body: CreateClosureRequest): Promise<Response> {
  const { start_date, end_date, reason, banner_text_de } = body;

  // ── Validate required fields ──────────────────────────────

  if (!start_date || !end_date) {
    return badRequest("Missing required fields: start_date, end_date");
  }

  if (end_date < start_date) {
    return badRequest("end_date must be >= start_date");
  }

  // ── Insert closure ────────────────────────────────────────

  const { data: closure, error: insertError } = await supabase
    .from("closures")
    .insert({
      start_date,
      end_date,
      reason: reason ?? null,
      banner_text_de: banner_text_de ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    log("error", "Failed to insert closure:", insertError);
    return serverError("Failed to create closure");
  }

  const closureId = closure.id;
  log("info", `Created closure ${closureId}: ${start_date} → ${end_date}`);

  // ── Pause active subscriptions ────────────────────────────

  const resumeDate = addDays(end_date, 1);

  // Find all active subscriptions that are not already paused past the start
  // of this closure. We want to pause any subscription that is:
  //   - status = 'active'
  //   - AND (paused_until IS NULL OR paused_until < start_date)
  // This means we skip subscriptions already paused through the closure period.
  const { data: activeSubs, error: fetchError } = await supabase
    .from("subscriptions")
    .select("id, customer_id")
    .eq("status", "active")
    .or(`paused_until.is.null,paused_until.lt.${start_date}`);

  if (fetchError) {
    log("error", "Failed to fetch active subscriptions:", fetchError);
    // We still return success for the closure itself, but note the failure
    return jsonResponse({
      closure_id: closureId,
      subscriptions_paused: 0,
      warning: "Closure created but failed to pause subscriptions",
    });
  }

  const activeSubscriptionIds = (activeSubs ?? []).map((s) => s.id);
  const subscriptionsPaused = activeSubscriptionIds.length;

  if (subscriptionsPaused > 0) {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        paused_until: resumeDate,
        status: "active", // keep status as active; paused_until signals the pause
        updated_at: new Date().toISOString(),
      })
      .in("id", activeSubscriptionIds);

    if (updateError) {
      log("error", "Failed to pause subscriptions:", updateError);
      return jsonResponse({
        closure_id: closureId,
        subscriptions_paused: 0,
        warning: "Closure created but failed to pause subscriptions",
      });
    }

    log(
      "info",
      `Paused ${subscriptionsPaused} subscriptions until ${resumeDate}`,
    );

    // ── Create notification records ───────────────────────────

    const notificationRecords = (activeSubs ?? [])
      .filter((s) => s.customer_id)
      .map((s) => ({
        customer_id: s.customer_id,
        type: "closure_notice" as const,
        channel: "both" as const,
        sent_at: new Date().toISOString(),
        delivered: false,
      }));

    if (notificationRecords.length > 0) {
      // Insert in batches to avoid PayloadTooLarge
      const BATCH_SIZE = 100;
      for (let i = 0; i < notificationRecords.length; i += BATCH_SIZE) {
        const batch = notificationRecords.slice(i, i + BATCH_SIZE);
        const { error: notifError } = await supabase
          .from("notifications")
          .insert(batch);

        if (notifError) {
          log("warn", `Failed to insert notification batch ${i}:`, notifError);
        }
      }

      log(
        "info",
        `Created ${notificationRecords.length} closure_notice notifications`,
      );
    }
  }

  return jsonResponse({
    closure_id: closureId,
    subscriptions_paused: subscriptionsPaused,
  });
}

/**
 * POST /delete
 *
 * Delete a closure by ID. Given closure_id, this will:
 *   1. Read the closure to get its dates
 *   2. Find subscriptions that were paused for this closure
 *   3. Resume them (set paused_until = NULL)
 *   4. Delete the closure
 *
 * Returns { subscriptions_resumed: N }.
 */
async function handleDelete(body: DeleteClosureRequest): Promise<Response> {
  const { closure_id } = body;

  if (!closure_id) {
    return badRequest("Missing required field: closure_id");
  }

  // ── Fetch the closure ─────────────────────────────────────

  const { data: closure, error: fetchError } = await supabase
    .from("closures")
    .select("id, start_date, end_date")
    .eq("id", closure_id)
    .single();

  if (fetchError || !closure) {
    log("error", "Closure not found:", fetchError ?? closure_id);
    return notFound(`Closure "${closure_id}" not found`);
  }

  const resumeDate = addDays(closure.end_date, 1);

  // ── Find and resume affected subscriptions ────────────────

  // Subscriptions were paused with paused_until = end_date + 1 day.
  // We look for subscriptions that are still paused to that exact date,
  // or more broadly, any subscription whose paused_until equals the
  // auto-resume date we set during create, and whose status allows
  // resuming (active or paused).
  const { data: pausedSubs, error: findError } = await supabase
    .from("subscriptions")
    .select("id")
    .in("status", ["active", "paused"])
    .eq("paused_until", resumeDate);

  if (findError) {
    log("error", "Failed to find paused subscriptions:", findError);
    return serverError("Failed to find paused subscriptions");
  }

  const pausedIds = (pausedSubs ?? []).map((s) => s.id);
  const subscriptionsResumed = pausedIds.length;

  if (subscriptionsResumed > 0) {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        paused_until: null,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .in("id", pausedIds);

    if (updateError) {
      log("error", "Failed to resume subscriptions:", updateError);
      return serverError("Failed to resume subscriptions");
    }

    log(
      "info",
      `Resumed ${subscriptionsResumed} subscriptions for closure ${closure_id}`,
    );
  }

  // ── Delete the closure ────────────────────────────────────

  const { error: deleteError } = await supabase
    .from("closures")
    .delete()
    .eq("id", closure_id);

  if (deleteError) {
    log("error", "Failed to delete closure:", deleteError);
    return serverError("Failed to delete closure");
  }

  log("info", `Deleted closure ${closure_id}`);

  return jsonResponse({
    subscriptions_resumed: subscriptionsResumed,
  });
}

/**
 * POST /active
 *
 * Check if there is an active closure right now (in Europe/Berlin timezone).
 * A closure is active if the current date falls between start_date and
 * end_date (inclusive).
 *
 * Returns:
 *   { active: true, closure: { start_date, end_date, banner_text_de, reason } }
 *   or
 *   { active: false, closure: null }
 */
async function handleActive(): Promise<Response> {
  const today = todayInTz();

  const { data: closure, error } = await supabase
    .from("closures")
    .select("start_date, end_date, banner_text_de, reason")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1)
    .maybeSingle();

  if (error) {
    log("error", "Failed to check active closure:", error);
    return serverError("Failed to check active closure");
  }

  if (!closure) {
    return jsonResponse({ active: false, closure: null });
  }

  return jsonResponse({
    active: true,
    closure: {
      start_date: closure.start_date,
      end_date: closure.end_date,
      banner_text_de: closure.banner_text_de,
      reason: closure.reason,
    },
  });
}

// ═════════════════════════════════════════════════════════════
// Request Router
// ═════════════════════════════════════════════════════════════

async function handleRequest(req: Request): Promise<Response> {
  // Only accept POST
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parse the URL path. Supabase includes the function name in the path
  // (e.g. "/closure-handler/active"), so route on the LAST segment.
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const action = path.split("/").pop() ?? "";

  // Parse JSON body (tolerant: /active takes no body)
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Route on the last path segment
  switch (action) {
    case "create":
      return await handleCreate(body as unknown as CreateClosureRequest);

    case "delete":
      return await handleDelete(body as unknown as DeleteClosureRequest);

    case "active":
      return await handleActive();

    default:
      return jsonResponse({ error: `Not found: ${path}` }, 404);
  }
}

// ── Serve ────────────────────────────────────────────────────

serve(handleRequest);
