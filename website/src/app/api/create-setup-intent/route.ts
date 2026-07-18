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

    // Check if customer exists in DB
    const { data: customer } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('email', email)
      .single();

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
      // Save to DB
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('email', email);
    }

    // Create SetupIntent
    const setupIntent = await getStripeClient().setupIntents.create({
      customer: stripeCustomerId ?? undefined,
      payment_method_types: ['card', 'sepa_debit'],
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
