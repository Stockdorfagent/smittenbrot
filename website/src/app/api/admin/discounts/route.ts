import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET: List all discounts with usage counts
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get all discounts
    const { data: discounts, error } = await supabase
      .from('discounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching discounts:', error);
      return NextResponse.json({ error: 'Fehler beim Laden der Rabattcodes' }, { status: 500 });
    }

    // Get usage counts for all discounts
    const discountIds = discounts?.map(d => d.id) || [];
    const usageMap: Record<string, number> = {};

    if (discountIds.length > 0) {
      const { data: usageData } = await supabase
        .from('discount_usage')
        .select('discount_id')
        .in('discount_id', discountIds);

      for (const u of usageData || []) {
        usageMap[u.discount_id] = (usageMap[u.discount_id] || 0) + 1;
      }
    }

    // Attach usage count to each discount
    const discountsWithUsage = (discounts || []).map(d => ({
      ...d,
      usage_count: usageMap[d.id] || 0,
    }));

    return NextResponse.json({ discounts: discountsWithUsage });
  } catch (err) {
    console.error('Admin discounts GET error:', err);
    return NextResponse.json({ error: 'Fehler beim Laden der Rabattcodes' }, { status: 500 });
  }
}

// POST: Create a new discount
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { code, description, type, value, max_uses, max_uses_per_customer, expires_at, active } = body;

    // Validation
    if (!code || typeof code !== 'string' || code.trim() === '') {
      return NextResponse.json({ error: 'Code ist erforderlich.' }, { status: 400 });
    }
    if (!type || !['percentage', 'fixed'].includes(type)) {
      return NextResponse.json({ error: 'Typ muss "percentage" oder "fixed" sein.' }, { status: 400 });
    }
    if (value === undefined || value === null || typeof value !== 'number' || value <= 0) {
      return NextResponse.json({ error: 'Wert muss eine positive Zahl sein.' }, { status: 400 });
    }
    if (type === 'percentage' && (value < 0 || value > 100)) {
      return NextResponse.json({ error: 'Prozentwert muss zwischen 0 und 100 liegen.' }, { status: 400 });
    }

    // Check for duplicate code (case-insensitive)
    const { data: existing } = await supabase
      .from('discounts')
      .select('id')
      .ilike('code', code.trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Dieser Rabattcode existiert bereits.' }, { status: 409 });
    }

    const { data: discount, error } = await supabase
      .from('discounts')
      .insert({
        code: code.trim().toUpperCase(),
        description: description || null,
        type,
        value,
        max_uses: max_uses !== undefined && max_uses !== null ? max_uses : null,
        max_uses_per_customer: max_uses_per_customer !== undefined && max_uses_per_customer !== null ? max_uses_per_customer : null,
        expires_at: expires_at || null,
        active: active !== undefined ? active : true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating discount:', error);
      return NextResponse.json({ error: 'Fehler beim Erstellen des Rabattcodes.' }, { status: 500 });
    }

    return NextResponse.json({ discount }, { status: 201 });
  } catch (err) {
    console.error('Admin discounts POST error:', err);
    return NextResponse.json({ error: 'Fehler beim Erstellen des Rabattcodes.' }, { status: 500 });
  }
}

// PUT: Update an existing discount
export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { id, code, description, type, value, max_uses, max_uses_per_customer, expires_at, active } = body;

    // Validation
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id ist erforderlich.' }, { status: 400 });
    }
    if (!code || typeof code !== 'string' || code.trim() === '') {
      return NextResponse.json({ error: 'Code ist erforderlich.' }, { status: 400 });
    }
    if (!type || !['percentage', 'fixed'].includes(type)) {
      return NextResponse.json({ error: 'Typ muss "percentage" oder "fixed" sein.' }, { status: 400 });
    }
    if (value === undefined || value === null || typeof value !== 'number' || value <= 0) {
      return NextResponse.json({ error: 'Wert muss eine positive Zahl sein.' }, { status: 400 });
    }
    if (type === 'percentage' && (value < 0 || value > 100)) {
      return NextResponse.json({ error: 'Prozentwert muss zwischen 0 und 100 liegen.' }, { status: 400 });
    }

    // Check for duplicate code (case-insensitive), excluding this discount
    const { data: existing } = await supabase
      .from('discounts')
      .select('id')
      .ilike('code', code.trim())
      .neq('id', id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Dieser Rabattcode existiert bereits.' }, { status: 409 });
    }

    const { data: discount, error } = await supabase
      .from('discounts')
      .update({
        code: code.trim().toUpperCase(),
        description: description || null,
        type,
        value,
        max_uses: max_uses !== undefined && max_uses !== null ? max_uses : null,
        max_uses_per_customer: max_uses_per_customer !== undefined && max_uses_per_customer !== null ? max_uses_per_customer : null,
        expires_at: expires_at || null,
        active: active !== undefined ? active : true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating discount:', error);
      return NextResponse.json({ error: 'Fehler beim Aktualisieren des Rabattcodes.' }, { status: 500 });
    }

    return NextResponse.json({ discount });
  } catch (err) {
    console.error('Admin discounts PUT error:', err);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Rabattcodes.' }, { status: 500 });
  }
}

// DELETE: Remove a discount (?id=...). Refuses if already used on real orders.
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id ist erforderlich.' }, { status: 400 });
    }

    // A discount referenced by real orders cannot be hard-deleted (FK + it would
    // orphan the invoice trail). Tell the admin to deactivate it instead.
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('discount_id', id);

    if (count && count > 0) {
      return NextResponse.json({
        error: 'Dieser Rabattcode wurde bereits in Bestellungen verwendet und kann nicht gelöscht werden. Deaktiviere ihn stattdessen.',
      }, { status: 409 });
    }

    const { error } = await supabase.from('discounts').delete().eq('id', id);
    if (error) {
      console.error('Error deleting discount:', error);
      return NextResponse.json({ error: 'Fehler beim Löschen des Rabattcodes.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Admin discounts DELETE error:', err);
    return NextResponse.json({ error: 'Fehler beim Löschen des Rabattcodes.' }, { status: 500 });
  }
}
