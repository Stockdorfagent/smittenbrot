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
    const supabase = getSupabaseAdmin();
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
