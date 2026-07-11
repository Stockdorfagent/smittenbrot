import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    // Check for active closure
    const closureRes = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/closure-handler/active`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const closureData = await closureRes.json();
    if (closureData.active) {
      return NextResponse.json({ error: closureData.closure?.banner_text_de || 'Aktuell findet keine Produktion statt.' }, { status: 503 });
    }

    const body = await req.json();
    const { items, customer_id, customer_email, customer_name, fulfillment_date, pickup_location_id, discount_code, billing_country } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // For logged-in users: check email is confirmed
    if (customer_id) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: user } = await supabase.auth.admin.getUserById(customer_id);
      if (user?.user && !user.user.email_confirmed_at) {
        return NextResponse.json({
          error: 'Bitte bestätige zuerst deine E-Mail-Adresse, bevor du bestellen kannst.',
        }, { status: 403 });
      }
    }

    // ── Country check ──
    const allowedCountries = ['DE', 'AT', 'CH'];
    if (billing_country && !allowedCountries.includes(billing_country)) {
      return NextResponse.json({
        error: 'Bestellungen sind nur aus Deutschland, Österreich und der Schweiz möglich.',
      }, { status: 403 });
    }

    if (!fulfillment_date) {
      return NextResponse.json({ error: 'fulfillment_date is required' }, { status: 400 });
    }

    // ── Backend capacity check ──
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const capacityErrors: string[] = [];
    for (const item of items) {
      // Get current orders for this product on this fulfillment date
      const { data: product } = await supabase
        .from('products')
        .select('id, name, capacity')
        .eq('id', item.product_id)
        .single();

      if (!product) continue;

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
      const requested = item.quantity ?? 1;
      const available = product.capacity;

      if (reserved + requested > available) {
        capacityErrors.push(
          `${product.name}: nur noch ${Math.max(0, available - reserved)} verfügbar (gewünscht: ${requested})`
        );
      }
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

    // Calculate total from server-side to prevent price manipulation
    const amount = items.reduce(
      (sum: number, item: { price_cents: number; quantity: number }) =>
        sum + item.price_cents * item.quantity,
      0
    );

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
      const existingCustomers = await stripe.customers.list({ email: customer_email, limit: 1 });
      if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
      } else {
        const newCustomer = await stripe.customers.create({
          email: customer_email,
          name: customer_name || undefined,
          metadata: { supabase_id: customer_id || '' },
        });
        stripeCustomerId = newCustomer.id;
      }
    }

    const idempotencyKey = `order_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    const metadata: Record<string, string> = {
      items: JSON.stringify(items.map((i: { product_id: string; quantity: number }) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      }))),
      fulfillment_date: fulfillment_date || '',
      pickup_location_id: pickup_location_id || '',
      idempotency_key: idempotencyKey,
    };

    if (appliedDiscountCode) {
      metadata.discount_code = appliedDiscountCode;
      metadata.discount_cents = String(finalDiscountCents);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalAmount, // cents
      currency: 'eur',
      customer: stripeCustomerId,
      setup_future_usage: customer_id ? 'off_session' : undefined,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

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
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
