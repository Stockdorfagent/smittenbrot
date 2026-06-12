import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminEmail = process.env.ADMIN_EMAIL || 'sophia@smittenbrot.de';

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, customers!inner(email)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Check if order can be cancelled (not already cancelled/refunded)
    if (order.status === 'cancelled' || order.status === 'refunded') {
      return NextResponse.json({ error: 'Bestellung wurde bereits storniert.' }, { status: 400 });
    }

    // Check if order is before cutoff time
    const now = new Date();
    const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const fulfillmentDate = new Date(order.fulfillment_date + 'T14:00:00+02:00');
    if (berlin > fulfillmentDate) {
      return NextResponse.json({ error: 'Bestellung kann nicht mehr storniert werden – für dich wird bereits gebacken.' }, { status: 400 });
    }

    // Refund via Stripe
    if (order.stripe_payment_intent_id) {
      try {
        await stripe.refunds.create({
          payment_intent: order.stripe_payment_intent_id,
        });
      } catch (stripeError: unknown) {
        const msg = stripeError instanceof Error ? stripeError.message : 'Refund failed';
        console.error('[refund-order] Stripe error:', msg);
        return NextResponse.json({ error: 'Rückerstattung fehlgeschlagen: ' + msg }, { status: 500 });
      }
    }

    // Update order status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'refunded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('[refund-order] Failed to update order:', updateError);
      return NextResponse.json({ error: 'Status-Update fehlgeschlagen' }, { status: 500 });
    }

    // Send admin notification
    try {
      const brevoKey = process.env.BREVO_API_KEY;
      if (brevoKey) {
        await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': brevoKey },
          body: JSON.stringify({
            sender: { email: 'kontakt@smittenbrot.de', name: 'Smittenbrot' },
            to: [{ email: adminEmail }],
            subject: `Stornierung: Bestellung ${orderId.substring(0, 8)}`,
            htmlContent: `<p>Eine Bestellung wurde storniert und der Betrag zurückerstattet.</p>
              <p><strong>Bestellung:</strong> ${orderId}</p>
              <p><strong>Kunde:</strong> ${order.customers?.email || order.customer_email || 'Unbekannt'}</p>
              <p><strong>Betrag:</strong> €${(order.total_cents / 100).toFixed(2)}</p>`,
          }),
        });
      }
    } catch {
      // Notification failure is non-critical
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[refund-order]', err);
    return NextResponse.json({ error: 'Fehler bei der Stornierung' }, { status: 500 });
  }
}
