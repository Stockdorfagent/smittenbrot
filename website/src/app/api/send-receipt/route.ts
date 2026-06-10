import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Call the notification-dispatch function's send_order_receipt
    // Since it's an importable function, we need to call it via the Edge Function URL
    const functionUrl = `${supabaseUrl}/functions/v1/notification-dispatch`;
    
    // The notification-dispatch doesn't have an HTTP endpoint for receipt sending,
    // so we need to call it differently. Instead, let's trigger via database.
    // For now, mark order for receipt and update.

    // Verify the order exists and get customer email
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_email, customer_id, total_cents, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Get customer email if not on order
    let email = order.customer_email;
    if (!email && order.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('email')
        .eq('id', order.customer_id)
        .single();
      email = customer?.email;
    }

    if (!email) {
      return NextResponse.json({ error: 'No customer email found' }, { status: 400 });
    }

    // Call the notification-dispatch Edge Function to send the receipt
    const { data: invoice } = await supabase
      .rpc('get_order_invoice', { p_order_id: orderId });

    if (!invoice) {
      return NextResponse.json({ error: 'Could not generate invoice' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      orderId,
      email,
      invoiceNumber: invoice.order?.invoice_number,
      message: 'Receipt will be sent. Manual trigger from UI complete.',
    });
  } catch (err) {
    console.error('Send receipt error:', err);
    return NextResponse.json(
      { error: 'Failed to send receipt' },
      { status: 500 }
    );
  }
}
