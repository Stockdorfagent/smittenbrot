import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Mark an order ready for pickup: notify the customer, then mark it fulfilled.
 *
 * This used to build its own Brevo email — which meant two different pickup
 * emails existed, the customer got NO push (the route only emailed), and the
 * message was rendered as one big red <h2>. It now delegates to
 * notification-dispatch/send-pickup-ready, the one implementation that sends
 * push AND email, uses the real order number, and logs the channel correctly.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const { order_id, extra_text } = await req.json();
    if (!order_id) return NextResponse.json({ error: 'missing order_id' }, { status: 400 });

    // Refuse to announce an unpaid order.
    //
    // This action does two irreversible things at once: it tells the customer
    // their bread is waiting, and it marks the order fulfilled. The second one
    // takes the order out of the 22:00 charge run, which only picks up
    // `scheduled` and `grace_period_open` — so announcing an unpaid order means
    // the customer is promised bread that will never be charged for.
    //
    // It has happened: one subscription order was announced seven days before
    // its pickup date and never paid, then survived its subscription's
    // cancellation because the cleanup trigger skips fulfilled orders.
    //
    // For anything paid outside the app (cash, transfer, Squarespace import),
    // use "Zahlung als erhalten markieren" first — that is what it is for.
    const supabase = getSupabaseAdmin();
    const { data: order, error: loadError } = await supabase
      .from('orders')
      .select('payment_status, status, customer_name')
      .eq('id', order_id)
      .single();

    if (loadError || !order) {
      return NextResponse.json({ error: 'Bestellung nicht gefunden.' }, { status: 404 });
    }
    if (order.payment_status !== 'paid') {
      return NextResponse.json(
        {
          error:
            'Diese Bestellung ist noch nicht bezahlt. Markiere zuerst die Zahlung ' +
            'als erhalten — sonst wird sie nie belastet.',
        },
        { status: 409 },
      );
    }

    const dispatchUrl =
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notification-dispatch/send-pickup-ready`;
    const res = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        order_ids: [order_id],
        ...(extra_text ? { extra_text } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[pickup-notification] dispatch failed:', res.status, JSON.stringify(body));
      return NextResponse.json(
        { error: 'Benachrichtigung konnte nicht gesendet werden.' },
        { status: 502 },
      );
    }

    // Only mark it off once the customer has actually been told.
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'fulfilled' })
      .eq('id', order_id);
    if (updateError) {
      console.error('[pickup-notification] could not mark fulfilled:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // notification-dispatch already logged the notification row (with the real
    // channel: push, email or both) — deliberately not duplicated here.
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Pickup notification error:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
