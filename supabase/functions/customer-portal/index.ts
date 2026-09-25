/**
 * customer-portal — opens Stripe's hosted Customer Portal for the logged-in
 * customer so they can add, remove and choose a default card themselves
 * ("Zahlungsmethoden verwalten" in Profil, app + website; owner 13./25.09.2026).
 *
 * The portal configuration (bpc_1UJYqwQc4LrgIEdOX255C69X, default) only allows
 * payment-method updates: no invoices, no subscription changes, no profile edits.
 * Requires a user JWT (verify_jwt on). The Stripe customer is looked up by e-mail
 * exactly like create-payment-intent does, created if missing, and the id is
 * stored on customers.stripe_customer_id.
 */
import Stripe from "stripe";
import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://smittenbrot.de").replace(/\/+$/, "");
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(bearer);
  if (error || !user?.email) return json({ error: "Nicht angemeldet." }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  // Only our own site as return target — never an arbitrary URL from the client.
  const rawReturn = typeof body.return_url === "string" ? body.return_url : "";
  const returnUrl = rawReturn.startsWith(`${SITE_URL}/`) ? rawReturn : `${SITE_URL}/profile`;

  try {
    const { data: row } = await supabase
      .from("customers").select("stripe_customer_id, name").eq("id", user.id).maybeSingle();
    let customerId = (row?.stripe_customer_id as string | null) ?? null;
    if (!customerId) {
      const existing = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = existing.data[0]?.id ??
        (await stripe.customers.create({
          email: user.email,
          name: (row?.name as string | null) ?? undefined,
          metadata: { supabase_id: user.id },
        })).id;
      await supabase.from("customers").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      locale: "de",
    });
    return json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[customer-portal]", msg);
    return json({ error: `Portal konnte nicht geöffnet werden: ${msg}` }, 500);
  }
});
