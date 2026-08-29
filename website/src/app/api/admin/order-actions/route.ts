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
 * Admin order actions, server-side and audited.
 *
 * Both of these used to be direct browser writes into `orders`:
 *
 * - mark_fulfilled ("Nur abhaken") takes the order out of the 22:00 charge
 *   run, which only picks up `scheduled`/`grace_period_open` — doing it to an
 *   unpaid order silently forfeits the money. It has happened once (see
 *   /api/send-pickup-notification). The loud warning lives in the client;
 *   the HARD rule lives here: unpaid needs the explicit allow_unpaid flag,
 *   because handing over unpaid bread legitimately happens (cash, imports).
 *
 * - mark_paid fires the invoice-numbering trigger (migrations 007/008/020),
 *   i.e. it ISSUES a §14 UStG invoice number. That must not hang off nothing
 *   but a client-side confirm() with no trace of who did it.
 *
 * Every action writes an audit_log row naming the admin who performed it.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const { order_id, action, allow_unpaid } = await req.json();
    if (!order_id || !action) {
      return NextResponse.json({ error: 'order_id und action sind erforderlich.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error: loadError } = await supabase
      .from('orders')
      .select('id, status, payment_status, order_number, invoice_number, fulfillment_date')
      .eq('id', order_id)
      .single();
    if (loadError || !order) {
      return NextResponse.json({ error: 'Bestellung nicht gefunden.' }, { status: 404 });
    }

    if (action === 'mark_fulfilled') {
      if (order.status === 'cancelled' || order.status === 'refunded') {
        return NextResponse.json(
          { error: 'Eine stornierte oder rückerstattete Bestellung kann nicht abgehakt werden.' },
          { status: 409 },
        );
      }
      // Idempotent: ticking off twice is not an error.
      if (order.status === 'fulfilled') {
        return NextResponse.json({ success: true, order: { status: 'fulfilled' } });
      }
      if (order.payment_status !== 'paid' && !allow_unpaid) {
        return NextResponse.json(
          {
            error:
              'Diese Bestellung ist noch nicht bezahlt. Markiere zuerst die Zahlung als ' +
              'erhalten — abgehakte Bestellungen werden vom Einzug übersprungen.',
          },
          { status: 409 },
        );
      }

      const { error: updErr } = await supabase
        .from('orders')
        .update({ status: 'fulfilled', updated_at: new Date().toISOString() })
        .eq('id', order_id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await supabase.from('audit_log').insert({
        action: 'admin_marked_fulfilled',
        entity_type: 'order',
        entity_id: order_id,
        old_data: { status: order.status, payment_status: order.payment_status },
        new_data: { status: 'fulfilled', allow_unpaid: !!allow_unpaid },
        performed_by: auth.user.id,
      });
      return NextResponse.json({ success: true, order: { status: 'fulfilled' } });
    }

    if (action === 'mark_paid') {
      // Idempotent: already paid is success, not an error.
      if (order.payment_status === 'paid') {
        return NextResponse.json({
          success: true,
          order: {
            payment_status: 'paid',
            order_number: order.order_number,
            invoice_number: order.invoice_number,
          },
        });
      }
      if (order.payment_status === 'refunded') {
        return NextResponse.json(
          { error: 'Eine rückerstattete Bestellung kann nicht als bezahlt markiert werden.' },
          { status: 409 },
        );
      }

      const { error: updErr } = await supabase
        .from('orders')
        .update({ payment_status: 'paid', updated_at: new Date().toISOString() })
        .eq('id', order_id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      // Re-read: the numbering trigger may just have assigned order/invoice
      // numbers, and the caller wants to show them without a full reload.
      const { data: fresh } = await supabase
        .from('orders')
        .select('payment_status, order_number, invoice_number')
        .eq('id', order_id)
        .single();

      await supabase.from('audit_log').insert({
        action: 'admin_marked_paid',
        entity_type: 'order',
        entity_id: order_id,
        old_data: {
          payment_status: order.payment_status,
          order_number: order.order_number,
          invoice_number: order.invoice_number,
        },
        new_data: {
          payment_status: 'paid',
          order_number: fresh?.order_number ?? null,
          invoice_number: fresh?.invoice_number ?? null,
        },
        performed_by: auth.user.id,
      });
      return NextResponse.json({
        success: true,
        order: fresh ?? { payment_status: 'paid' },
      });
    }

    return NextResponse.json({ error: `Unbekannte Aktion: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[admin/order-actions]', err);
    return NextResponse.json({ error: 'Aktion fehlgeschlagen.' }, { status: 500 });
  }
}
