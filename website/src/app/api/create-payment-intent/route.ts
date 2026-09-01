import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function getStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    // Check for active closure (optional — Edge Function may not exist)
    try {
      const closureRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/closure-handler/active`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (closureRes.ok) {
        const closureData = await closureRes.json();
        if (closureData.active === true) {
          return NextResponse.json({ error: closureData.closure?.banner_text_de || 'Aktuell findet keine Produktion statt.' }, { status: 503 });
        }
      }
    } catch {
      // closure handler not deployed on this Supabase project — proceed
    }

    const body = await req.json();
    const { items, customer_id, customer_email, customer_name, fulfillment_date, pickup_location_id, discount_code } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // For logged-in users: check email is confirmed
    if (customer_id) {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: user } = await supabase.auth.admin.getUserById(customer_id);
      if (user?.user && !user.user.email_confirmed_at) {
        return NextResponse.json({
          error: 'Bitte bestätige zuerst deine E-Mail-Adresse, bevor du bestellen kannst.',
        }, { status: 403 });
      }
    }

    if (!fulfillment_date) {
      return NextResponse.json({ error: 'fulfillment_date is required' }, { status: 400 });
    }

    // ── Backend capacity check ──
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const capacityErrors: string[] = [];
    const priceMap: Record<string, { price_cents: number; name: string }> = {};
    let subtotalCents = 0;
    for (const item of items) {
      const requested = Number(item.quantity);
      if (!Number.isInteger(requested) || requested < 1) {
        return NextResponse.json({ error: 'Ungültige Menge.' }, { status: 400 });
      }

      // Load the authoritative product record (price + capacity) from the DB —
      // never trust a price sent by the client.
      const { data: product } = await supabase
        .from('products')
        .select('id, name, capacity, price_cents')
        .eq('id', item.product_id)
        .single();

      if (!product) {
        return NextResponse.json({ error: 'Ein Produkt ist nicht (mehr) verfügbar.' }, { status: 400 });
      }
      priceMap[product.id] = { price_cents: product.price_cents, name: product.name };
      subtotalCents += product.price_cents * requested;

      const { count: reservedCount } = await supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', item.product_id)
        .in('order_id', (
          await supabase
            .from('orders')
            .select('id')
            .eq('fulfillment_date', fulfillment_date)
            .not('status', 'in', '("cancelled","refunded")')
        ).data?.map(o => o.id) ?? []);

      const reserved = reservedCount ?? 0;
      const available = product.capacity;

      if (reserved + requested > available) {
        capacityErrors.push(
          `${product.name}: nur noch ${Math.max(0, available - reserved)} verfügbar (gewünscht: ${requested})`
        );
      }
    }

    // Business rule (owner, 2026-09-02): orders above 250 € need individual
    // arrangement (and § 33 UStDV simplified invoices stop at 250 €). The
    // checkout surfaces `error` directly, so it carries the German sentence.
    if (subtotalCents > 25000) {
      return NextResponse.json({
        error: 'Für Bestellungen über 250 € kontaktiere uns bitte vorab über das Kontaktformular – wir vereinbaren Abholung und Details individuell.',
      }, { status: 400 });
    }

    if (capacityErrors.length > 0) {
      // Send admin alert about oversell attempt
      const adminEmail = process.env.ADMIN_EMAIL ?? 'sophia@smittenbrot.de';
      // Log the attempt
      console.warn(`[capacity-warning] Oversell attempt: ${capacityErrors.join('; ')}`);

      return NextResponse.json({
        error: 'capacity_exceeded',
        details: capacityErrors,
        message: 'Einige Produkte sind für diesen Tag leider ausverkauft.',
      }, { status: 409 });
    }

    // Total is computed from authoritative DB prices in the loop above —
    // the client-supplied price is never used.
    const amount = subtotalCents;

    // ── Discount calculation ──
    let finalAmount = amount;
    let discountId: string | null = null;
    let finalDiscountCents = 0;
    let appliedDiscountCode: string | null = null;

    if (discount_code) {
      const { data: discount } = await supabase
        .from('discounts')
        .select('*')
        .ilike('code', discount_code)
        .single();

      if (discount && discount.active) {
        // Check expiration
        const isExpired = discount.expires_at && new Date(discount.expires_at) < new Date();
        if (!isExpired) {
          // Check max uses (global)
          let canUse = true;
          if (discount.max_uses !== null && discount.max_uses !== undefined) {
            const { count: usageCount } = await supabase
              .from('discount_usage')
              .select('*', { count: 'exact', head: true })
              .eq('discount_id', discount.id);
            if (usageCount !== null && usageCount >= discount.max_uses) {
              canUse = false;
            }
          }

          // Check max uses per customer
          if (canUse && discount.max_uses_per_customer !== null && discount.max_uses_per_customer !== undefined) {
            const email = customer_email || '';
            const { count: emailUsageCount } = await supabase
              .from('discount_usage')
              .select('*', { count: 'exact', head: true })
              .eq('discount_id', discount.id)
              .eq('email', email);
            if (emailUsageCount !== null && emailUsageCount >= discount.max_uses_per_customer) {
              canUse = false;
            }
          }

          if (canUse) {
            discountId = discount.id;
            appliedDiscountCode = discount.code;

            if (discount.type === 'percentage') {
              finalDiscountCents = Math.round((amount * discount.value) / 100);
            } else if (discount.type === 'fixed') {
              finalDiscountCents = Math.min(discount.value, amount);
            }

            finalAmount = Math.max(0, amount - finalDiscountCents);
          }
        }
      }
    }

    // Create or retrieve Stripe customer
    let stripeCustomerId: string | undefined;
    if (customer_id) {
      // Check if customer exists in Stripe
      const existingCustomers = await getStripeClient().customers.list({ email: customer_email, limit: 1 });
      if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
      } else {
        const newCustomer = await getStripeClient().customers.create({
          email: customer_email,
          name: customer_name || undefined,
          metadata: { supabase_id: customer_id || '' },
        });
        stripeCustomerId = newCustomer.id;
      }
    }

    const idempotencyKey = `order_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Encode the order compactly for the PaymentIntent metadata. The shared
    // stripe-webhook creates the order on payment success from this metadata
    // (order-on-success model — a failed/abandoned payment leaves no order and
    // no invoice number). Items use the {p,q,u} shape with the authoritative DB
    // unit price, matching the mobile app's create-payment-intent edge function.
    const itemsMeta = JSON.stringify(
      (items as { product_id: string; quantity: number }[]).map(i => ({
        p: i.product_id,
        q: Number(i.quantity),
        u: priceMap[i.product_id]!.price_cents,
      }))
    );
    const metadata: Record<string, string> = {
      fulfillment_date: fulfillment_date,
      pickup_location_id: pickup_location_id || '',
      customer_id: customer_id || '',
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      idempotency_key: idempotencyKey,
    };

    // Stripe caps each metadata value at 500 chars; split the item list across
    // items, items_1, items_2, … so large orders aren't rejected. The webhook
    // reassembles the chunks. (Stripe also caps total keys at 50.)
    const CHUNK = 450;
    if (Math.ceil(itemsMeta.length / CHUNK) > 40) {
      return NextResponse.json(
        { error: 'Bestellung zu groß. Bitte teile sie in kleinere Bestellungen auf.' },
        { status: 400 }
      );
    }
    for (let i = 0; i * CHUNK < itemsMeta.length; i++) {
      metadata[i === 0 ? 'items' : `items_${i}`] = itemsMeta.slice(i * CHUNK, (i + 1) * CHUNK);
    }

    if (discountId) {
      metadata.discount_id = discountId;
      metadata.discount_cents = String(finalDiscountCents);
      metadata.discount_code = appliedDiscountCode || '';
    }

    const paymentIntent = await getStripeClient().paymentIntents.create(
      {
        amount: finalAmount, // cents (already discounted)
        currency: 'eur',
        customer: stripeCustomerId,
        setup_future_usage: customer_id ? 'off_session' : undefined,
        metadata,
        payment_method_types: ['card'],
      },
      { idempotencyKey }
    );

    // NOTE: the order is intentionally NOT created here. The stripe-webhook
    // creates it from the metadata above once payment_intent.succeeded arrives.

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      idempotencyKey,
      discountId,
      discountCents: finalDiscountCents,
      appliedDiscountCode,
    });
  } catch (err) {
    console.error('Stripe payment intent error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to create payment intent: ${errorMessage}` },
      { status: 500 }
    );
  }
}
