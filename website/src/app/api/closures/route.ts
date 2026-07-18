import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const EDGE_FN_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/closure-handler`;

export async function POST(req: NextRequest) {
  try {
    const { action, closure_id, start_date, end_date, reason, banner_text_de } = await req.json();

    // 'active' is a public read (used by the site-wide closure banner).
    // 'create' and 'delete' mutate state and require admin.
    if (action === 'create' || action === 'delete') {
      const auth = await requireAdmin(req);
      if ('response' in auth) return auth.response;
    }

    if (action === 'create') {
      // 1. Insert the closure
      const { data: closure, error: insertError } = await supabase
        .from('closures')
        .insert({ start_date, end_date, reason: reason || null, banner_text_de: banner_text_de || null })
        .select('id')
        .single();
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

      // 2. Call Edge Function to pause subscriptions
      await fetch(`${EDGE_FN_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ start_date, end_date, reason, banner_text_de }),
      });

      return NextResponse.json({ id: closure.id });
    }

    if (action === 'delete') {
      // 1. Call Edge Function to resume subscriptions
      await fetch(`${EDGE_FN_URL}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ closure_id }),
      });

      // 2. Delete the closure
      await supabase.from('closures').delete().eq('id', closure_id);
      return NextResponse.json({ success: true });
    }

    if (action === 'active') {
      const res = await fetch(`${EDGE_FN_URL}/active`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Closure API error:', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
