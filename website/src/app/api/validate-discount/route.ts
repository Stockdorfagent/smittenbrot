import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, email, items, fulfillment_date } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ valid: false, error: 'Code ist erforderlich.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ valid: false, error: 'E-Mail ist erforderlich.' }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ valid: false, error: 'Warenkorb ist leer.' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up the discount by code
    const { data: discount, error: discountError } = await supabase
      .from('discounts')
      .select('*')
      .ilike('code', code)
      .single();

    if (discountError || !discount) {
      return NextResponse.json({ valid: false, error: 'Rabattcode nicht gefunden.' });
    }

    // Check if discount is active
    if (!discount.active) {
      return NextResponse.json({ valid: false, error: 'Dieser Rabattcode ist nicht mehr gültig.' });
    }

    // Check if discount has expired
    if (discount.expires_at && new Date(discount.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: 'Dieser Rabattcode ist abgelaufen.' });
    }

    // Check max uses (global)
    if (discount.max_uses !== null && discount.max_uses !== undefined) {
      const { count: usageCount } = await supabase
        .from('discount_usage')
        .select('*', { count: 'exact', head: true })
        .eq('discount_id', discount.id);

      if (usageCount !== null && usageCount >= discount.max_uses) {
        return NextResponse.json({ valid: false, error: 'Dieser Rabattcode wurde bereits maximal verwendet.' });
      }
    }

    // Check max uses per customer (by email)
    if (discount.max_uses_per_customer !== null && discount.max_uses_per_customer !== undefined) {
      const { count: emailUsageCount } = await supabase
        .from('discount_usage')
        .select('*', { count: 'exact', head: true })
        .eq('discount_id', discount.id)
        .eq('email', email);

      if (emailUsageCount !== null && emailUsageCount >= discount.max_uses_per_customer) {
        return NextResponse.json({ valid: false, error: 'Du hast diesen Rabattcode bereits verwendet.' });
      }
    }

    // Calculate the total from items
    const totalCents = items.reduce(
      (sum: number, item: { price_cents: number; quantity: number }) =>
        sum + item.price_cents * item.quantity,
      0
    );

    // Calculate discount amount
    let discountCents = 0;
    if (discount.type === 'percentage') {
      discountCents = Math.round((totalCents * discount.value) / 100);
    } else if (discount.type === 'fixed') {
      discountCents = Math.min(discount.value, totalCents); // don't go negative
    }

    const totalAfterDiscount = Math.max(0, totalCents - discountCents);

    return NextResponse.json({
      valid: true,
      discount: {
        id: discount.id,
        code: discount.code,
        description: discount.description,
        type: discount.type,
        value: discount.value,
      },
      discountCents,
      totalAfterDiscount,
    });
  } catch (err) {
    console.error('Validate discount error:', err);
    return NextResponse.json(
      { valid: false, error: 'Fehler bei der Rabattprüfung.' },
      { status: 500 }
    );
  }
}
