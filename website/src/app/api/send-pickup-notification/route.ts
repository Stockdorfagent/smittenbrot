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

    // Single id (the per-order button) or an array (bulk from the bake-day
    // view) — normalised to one list; the dispatch function takes an array
    // natively and this route was the only thing limiting it to one.
    const { order_id, order_ids, extra_text } = await req.json();
    const ids: string[] = Array.isArray(order_ids)
      ? order_ids.filter((x: unknown): x is string => typeof x === 'string')
      : order_id
        ? [order_id]
        : [];
    if (ids.length === 0) return NextResponse.json({ error: 'missing order_id(s)' }, { status: 400 });
    if (ids.length > 100) return NextResponse.json({ error: 'zu viele Bestellungen auf einmal (max. 100)' }, { status: 400 });

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
    const { data: orders, error: loadError } = await supabase
      .from('orders')
      .select('id, payment_status, status, customer_name')
      .in('id', ids);

    if (loadError || !orders || orders.length === 0) {
      return NextResponse.json({ error: 'Bestellung(en) nicht gefunden.' }, { status: 404 });
    }

    // Partition instead of all-or-nothing: on a bake day one ineligible order
    // must not block notifying the other twenty. Ineligible ones are reported
    // back by name; the unpaid rule is the same hard stop as ever.
    const eligible: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const order of orders) {
      const name = (order.customer_name as string | null) ?? order.id.substring(0, 8);
      if (order.status === 'cancelled' || order.status === 'refunded') {
        skipped.push({ name, reason: 'storniert' });
      } else if (order.status === 'fulfilled') {
        skipped.push({ name, reason: 'bereits erledigt' });
      } else if (order.payment_status !== 'paid') {
        skipped.push({ name, reason: 'nicht bezahlt — zuerst Zahlung als erhalten markieren' });
      } else {
        eligible.push(order.id as string);
      }
    }
    if (eligible.length === 0) {
      return NextResponse.json(
        {
          error:
            ids.length === 1 && skipped[0]?.reason.startsWith('nicht bezahlt')
              ? 'Diese Bestellung ist noch nicht bezahlt. Markiere zuerst die Zahlung ' +
                'als erhalten — sonst wird sie nie belastet.'
              : `Keine der Bestellungen kann gemeldet werden: ${skipped
                  .map((sk) => `${sk.name} (${sk.reason})`)
                  .join(', ')}`,
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
        order_ids: eligible,
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

    // Only mark off the orders whose customers were actually told — the
    // dispatch result is per order.
    const dispatchResults = (body as {
      results?: { orderId: string; success: boolean; error?: string }[];
    }).results ?? [];
    const notified = dispatchResults.filter((r) => r.success).map((r) => r.orderId);
    const failed = dispatchResults
      .filter((r) => !r.success)
      .map((r) => ({ orderId: r.orderId, error: r.error ?? 'unbekannt' }));

    if (notified.length > 0) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'fulfilled' })
        .in('id', notified);
      if (updateError) {
        console.error('[pickup-notification] could not mark fulfilled:', updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // notification-dispatch already logged the notification rows (with the
    // real channel: push, email or both) — deliberately not duplicated here.
    return NextResponse.json({
      success: notified.length > 0,
      notified: notified.length,
      notified_ids: notified,
      skipped,
      failed,
    });
  } catch (err) {
    console.error('Pickup notification error:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
