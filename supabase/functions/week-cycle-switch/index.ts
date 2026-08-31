// ============================================================
// Smittenbrot — Week Cycle Switch Edge Function
// ============================================================
// Manages the A/B week cycle.
//
// Routes (all POST):
//   /          - Toggle the current week (A → B, B → A)
//   /current   - Return the current week and switched_at
//
// Scheduled: Cron every Thursday at 22:01 Europe/Berlin.
// The shop displays Week A products in A-weeks and Week B products
// in B-weeks. Permanent products always show.
// ============================================================

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

// ── Environment Variables ────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Shared secret the pg_net cron sends as Bearer (migration 026) — same
// secret as the subscription-engine cron actions (migration 024).
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// ── Clients ──────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ── Constants ────────────────────────────────────────────────

const TIMEZONE = "Europe/Berlin";

// ── Logging ──────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const tag = "[week-cycle-switch]";
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

// ── Response Helpers ─────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

function serverError(message: string): Response {
  log("error", message);
  return jsonResponse({ error: "Internal server error" }, 500);
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Toggle the week cycle: A ↔ B.
 * Reads the single row from week_cycle, toggles current_week,
 * updates switched_at to now(), and logs to audit_log.
 */
async function handleToggle(): Promise<Response> {
  try {
    // 1. Read the current week from the week_cycle table
    const { data: row, error: readError } = await supabase
      .from("week_cycle")
      .select("id, current_week, switched_at")
      .limit(1)
      .single();

    if (readError || !row) {
      log("error", "Failed to read week_cycle:", readError);
      return serverError("Could not read week_cycle row");
    }

    const previousWeek = row.current_week as "A" | "B";
    const newWeek: "A" | "B" = previousWeek === "A" ? "B" : "A";
    const now = new Date().toISOString();
    const weekCycleId = row.id;

    // 2. Update the week_cycle row
    const { error: updateError } = await supabase
      .from("week_cycle")
      .update({
        current_week: newWeek,
        switched_at: now,
      })
      .eq("id", weekCycleId);

    if (updateError) {
      log("error", "Failed to update week_cycle:", updateError);
      return serverError("Could not update week_cycle");
    }

    // 3. Log to audit_log
    const { error: auditError } = await supabase
      .from("audit_log")
      .insert({
        action: "week_switch",
        entity_type: "week_cycle",
        entity_id: weekCycleId,
        old_data: { current_week: previousWeek, switched_at: row.switched_at },
        new_data: { current_week: newWeek, switched_at: now },
        performed_by: null, // cron job, no authenticated user
      });

    if (auditError) {
      log("warn", "Failed to write audit_log (non-fatal):", auditError);
    }

    log("info", `Week switched: ${previousWeek} → ${newWeek} at ${now}`);

    // 4. Return result
    return jsonResponse({
      previous_week: previousWeek,
      new_week: newWeek,
      switched_at: now,
    });
  } catch (err) {
    log("error", "Unexpected error during toggle:", err);
    return serverError("Unexpected error during week switch");
  }
}

/**
 * POST /current
 * Returns the current week and switched_at timestamp.
 * Called by the website/app to determine which products to show.
 */
async function handleCurrent(): Promise<Response> {
  try {
    const { data, error } = await supabase
      .from("week_cycle")
      .select("current_week, switched_at")
      .limit(1)
      .single();

    if (error || !data) {
      log("error", "Failed to read week_cycle:", error);
      return serverError("Could not read week_cycle");
    }

    return jsonResponse({
      current_week: data.current_week,
      switched_at: data.switched_at,
    });
  } catch (err) {
    log("error", "Unexpected error reading current week:", err);
    return serverError("Unexpected error reading current week");
  }
}

// ═════════════════════════════════════════════════════════════
// Router
// ═════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Only accept POST requests
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  log("info", `Request: POST ${path}`);

  // Supabase mounts the function at /week-cycle-switch, so match the last
  // path segment rather than an exact "/" (which never matches when deployed).
  const action = path.replace(/\/+$/, "").split("/").pop() ?? "";
  if (action === "current") {
    // Deliberately public: the shop and the app read the current week here.
    return await handleCurrent();
  }

  // Root (…/week-cycle-switch) → toggle. Guarded: an unauthenticated toggle
  // flips which products the whole shop sells this week. Allowed callers:
  // the pg_net cron (CRON_SECRET from Vault, migration 026), a trusted
  // server (the runtime-injected service key), or an authenticated user with
  // customers.is_admin (the website's Einstellungen button forwards the
  // admin's own JWT — deliberately not a service-key comparison, since the
  // runtime-injected key value differs from the one our servers hold).
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const bySecret =
    (CRON_SECRET.length > 0 && bearer === CRON_SECRET) ||
    (SUPABASE_SERVICE_ROLE_KEY.length > 0 && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (!bySecret) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(bearer);
    if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);
    const { data: caller } = await supabase
      .from("customers")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!caller?.is_admin) return jsonResponse({ error: "Nicht autorisiert." }, 403);
  }
  return await handleToggle();
});
