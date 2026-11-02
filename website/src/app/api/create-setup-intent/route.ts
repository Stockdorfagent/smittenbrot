import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireUser } from '@/lib/apiAuth';

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
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;

    // Use the authenticated user's own email — never trust a client-supplied one.
    const email = auth.user.email;
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // Find or create Stripe customer
    let stripeCustomerId: string | null = null;

    // The caller's own profile row — by id, not by e-mail (02.11.2026): an
    // e-mail lookup would let a forged customers.email on another row pick up
    // or receive this customer's Stripe customer id.
    const { data: customer } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (customer?.stripe_customer_id) {
      stripeCustomerId = customer.stripe_customer_id;
    } else {
      // Look up by email in Stripe
      const existing = await getStripeClient().customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        stripeCustomerId = existing.data[0].id;
      } else {
        const newCustomer = await getStripeClient().customers.create({ email });
        stripeCustomerId = newCustomer.id;
      }
      // Save to DB (own row only)
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', auth.user.id);
    }

    // Create SetupIntent
    const setupIntent = await getStripeClient().setupIntents.create({
      customer: stripeCustomerId ?? undefined,
      // card only — matches the edge function; sepa_debit is not enabled on the live
      // account and Stripe rejects a SetupIntent that lists an unavailable type.
      payment_method_types: ['card'],
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      stripeCustomerId,
    });
  } catch (err: unknown) {
    console.error('[create-setup-intent]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create setup intent' },
      { status: 500 },
    );
  }
}
