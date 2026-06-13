import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const BREVO_API_KEY = process.env.BREVO_API_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { order_id } = await req.json();
    if (!order_id) return NextResponse.json({ error: 'missing order_id' }, { status: 400 });

    // Fetch order with pickup location
    const { data: order } = await supabase
      .from('orders')
      .select('*, pickup_locations!inner(name, address, notification_template, cabinet_code)')
      .eq('id', order_id)
      .single();

    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

    const location = order.pickup_locations;
    const template = location?.notification_template || 'Deine Bestellung {ORDER_NUMBER} ist abholbereit bei {PICKUP_LOCATION}.';
    const orderNum = order.order_number?.replace(/^0+/, '') || '---';

    const message = template
      .replace('{ORDER_NUMBER}', orderNum)
      .replace('{PICKUP_LOCATION}', location?.name || '')
      .replace('{CODE}', location?.cabinet_code || '')
      .replace('{PICKUP_TIME}', '');

    const recipientEmail = order.customer_email;
    if (!recipientEmail) return NextResponse.json({ error: 'no customer email' }, { status: 400 });

    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: 'info@smittenbrot.de', name: 'Smittenbrot' },
        to: [{ email: recipientEmail }],
        subject: `Deine Smittenbrot Bestellung #${orderNum} ist abholbereit!`,
        textContent: message,
        htmlContent: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
          <h2 style="color:#f8120e;font-size:20px;">${message.replace(/\n/g, '<br>')}</h2>
          <p style="color:#555;margin-top:16px;font-size:14px;">Liebe Grüße aus Stockdorf<br>Sophia</p>
        </div>`,
      }),
    });

    // Mark as fulfilled
    await supabase.from('orders').update({ status: 'fulfilled' }).eq('id', order_id);

    // Log notification
    await supabase.from('notifications').insert({
      customer_id: order.customer_id,
      type: 'pickup_ready',
      channel: 'email',
      sent_at: new Date().toISOString(),
      delivered: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Pickup notification error:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
