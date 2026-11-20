// ============================================================
// Smittenbrot — Closure Handler Edge Function
// ============================================================
// Handles bakery closures: create (notify subscribers), delete, and the
// active check. Closed bake days are skipped by the shop, the app and the
// subscription engine, which all read the closures table directly.
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

// ═════════════════════════════════════════════════════════════
// Route Handlers
// ═════════════════════════════════════════════════════════════

/**
 * First Wednesday/Saturday after `dateISO` that is not inside a closure —
 * the next bake day, named in the notice to subscribers.
 */
async function firstOpenPickupAfter(dateISO: string): Promise<string> {
  const { data } = await supabase
    .from("closures")
    .select("start_date, end_date")
    .gte("end_date", dateISO);
  const closures = (data ?? []) as { start_date: string; end_date: string }[];
  const [y, m, d] = dateISO.split("-").map(Number);
  for (let i = 1; i <= 70; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    const dow = t.getUTCDay();
    if (dow !== 3 && dow !== 6) continue;
    const iso = t.toISOString().slice(0, 10);
    if (!closures.some((c) => c.start_date <= iso && iso <= c.end_date)) return iso;
  }
  return dateISO;
}

/**
 * POST /create
 *
 * Create a new bakery closure (start_date, end_date, optional reason and
 * banner_text_de) and tell every active or paused subscriber.
 *
 * Since 20.11.2026 this does NOT pause subscriptions any more. The
 * subscription engine skips closed bake days itself (no reminder, no order,
 * no charge), which also covers an Abo that is paused now and resumes inside
 * the closure — the old pause-on-create missed exactly that case, and its
 * paused_until = end_date + 1 blocked one pickup too many when the day after
 * the closure was a bake day. The shop and the app skip closed days too.
 *
 * Returns { closure_id, subscribers_notified: N }.
 */
async function handleCreate(body: CreateClosureRequest): Promise<Response> {
  const { start_date, end_date, reason, banner_text_de } = body;

  // ── Validate required fields ──────────────────────────────

  if (!start_date || !end_date) {
    return badRequest("Missing required fields: start_date, end_date");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return badRequest("Dates must be YYYY-MM-DD");
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

  // ── Tell the subscribers ──────────────────────────────────
  // Active AND paused Abos: a pause may end inside the closure. Sent through
  // notification-dispatch (e-mail + push, logged there); a failure to notify
  // never fails the closure itself.

  const { data: subs, error: fetchError } = await supabase
    .from("subscriptions")
    .select("customer_id")
    .in("status", ["active", "paused"]);

  if (fetchError) {
    log("error", "Failed to fetch subscriptions:", fetchError);
    return jsonResponse({
      closure_id: closureId,
      subscribers_notified: 0,
      warning: "Closure created but subscribers could not be notified",
    });
  }

  const customerIds = [...new Set((subs ?? []).map((s) => s.customer_id as string | null).filter((id): id is string => !!id))];
  const nextPickup = await firstOpenPickupAfter(end_date);
  let notified = 0;
  for (const customerId of customerIds) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatch/send-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          customer_id: customerId,
          type: "closure_notice",
          channel: "both",
          data: { start_date, end_date, next_pickup: nextPickup, closure_id: closureId },
        }),
      });
      if (resp.ok) notified++;
      else log("warn", `closure_notice for ${customerId} returned ${resp.status}: ${await resp.text()}`);
    } catch (err) {
      log("warn", `closure_notice for ${customerId} failed:`, err);
    }
  }
  log("info", `Notified ${notified}/${customerIds.length} subscribers about closure ${closureId}`);

  return jsonResponse({
    closure_id: closureId,
    subscribers_notified: notified,
  });
}

/**
 * POST /delete
 *
 * Delete a closure by ID. Nothing else to undo since 20.11.2026: the engine
 * and the shop read the closures table live, so the days are orderable again
 * as soon as the row is gone.
 *
 * Returns { deleted: true }.
 */
async function handleDelete(body: DeleteClosureRequest): Promise<Response> {
  const { closure_id } = body;

  if (!closure_id) {
    return badRequest("Missing required field: closure_id");
  }

  const { data: closure, error: fetchError } = await supabase
    .from("closures")
    .select("id, start_date, end_date")
    .eq("id", closure_id)
    .single();

  if (fetchError || !closure) {
    log("error", "Closure not found:", fetchError ?? closure_id);
    return notFound(`Closure "${closure_id}" not found`);
  }

  const { error: deleteError } = await supabase
    .from("closures")
    .delete()
    .eq("id", closure_id);

  if (deleteError) {
    log("error", "Failed to delete closure:", deleteError);
    return serverError("Failed to delete closure");
  }

  log("info", `Deleted closure ${closure_id} (${closure.start_date} → ${closure.end_date})`);

  return jsonResponse({ deleted: true });
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


// ── Caller check (code review 02.11.2026, finding 4) ─────────
// The gateway's verify_jwt only proves a valid project JWT — the PUBLIC anon
// key passes it (verified live 02.11.2026). Mutating routes therefore check
// the caller here: the runtime service key (edge-to-edge calls), the cron
// secret (Vault, migration 024), or a signed-in user with customers.is_admin
// (the website's admin routes forward the admin's own JWT; a service-key
// comparison would fail there because the runtime-injected key value differs
// from the one our servers hold).
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function authorizeCaller(req: Request): Promise<Response | null> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return jsonResponse({ error: "Unauthorized" }, 401);
  if (CRON_SECRET.length > 0 && bearer === CRON_SECRET) return null;
  if (SUPABASE_SERVICE_ROLE_KEY.length > 0 && bearer === SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data: { user }, error } = await supabase.auth.getUser(bearer);
  if (error || !user) return jsonResponse({ error: "Unauthorized" }, 401);
  const { data: caller } = await supabase
    .from("customers")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller?.is_admin) return jsonResponse({ error: "Nicht autorisiert." }, 403);
  return null;
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

  // Route on the last path segment. /active is a public read (banners);
  // create/delete change every Abo and block checkout → caller check.
  switch (action) {
    case "create": {
      const denied = await authorizeCaller(req);
      if (denied) return denied;
      return await handleCreate(body as unknown as CreateClosureRequest);
    }

    case "delete": {
      const denied = await authorizeCaller(req);
      if (denied) return denied;
      return await handleDelete(body as unknown as DeleteClosureRequest);
    }

    case "active":
      return await handleActive();

    default:
      return jsonResponse({ error: `Not found: ${path}` }, 404);
  }
}

// ── Serve ────────────────────────────────────────────────────

serve(handleRequest);
