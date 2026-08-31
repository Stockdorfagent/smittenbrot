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
 * Admin system actions, server-side and audited.
 *
 * - switch_week: the settings page used to write `week_cycle` directly,
 *   bypassing the week-cycle-switch edge function that the cron uses — so a
 *   manual switch never appeared in the audit log and could drift from the
 *   function's semantics. It now goes through the same function (which writes
 *   its own audit row), plus a row here naming the admin who triggered it.
 *
 * - set_invoice_mode: flips the invoice numbering series between test and
 *   production (migration 008) — a change with bookkeeping consequences that
 *   used to leave no trace. Now audited with who/old/new.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const { action, invoice_mode } = await req.json();
    const supabase = getSupabaseAdmin();

    if (action === 'switch_week') {
      // The admin's OWN JWT — the function's toggle gate accepts a caller
      // with customers.is_admin. (Not the service key: the runtime-injected
      // key value differs from the one our servers hold.)
      const callerToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/week-cycle-switch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${callerToken}`,
          },
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[admin/system-actions] week switch failed:', res.status, JSON.stringify(body));
        return NextResponse.json({ error: 'Wochenwechsel fehlgeschlagen.' }, { status: 502 });
      }
      // The function's own audit row has performed_by = null (it cannot know);
      // this one records WHO pressed the button. Its response carries no row
      // id, so fetch it — the table has exactly one row.
      const { data: wc } = await supabase.from('week_cycle').select('id').limit(1).single();
      await supabase.from('audit_log').insert({
        action: 'admin_week_switch',
        entity_type: 'week_cycle',
        entity_id: wc?.id ?? '00000000-0000-0000-0000-000000000000',
        old_data: { current_week: body.previous_week ?? null },
        new_data: { current_week: body.new_week ?? null, via: 'admin settings page' },
        performed_by: auth.user.id,
      });
      return NextResponse.json({ success: true, ...body });
    }

    if (action === 'set_invoice_mode') {
      if (invoice_mode !== 'test' && invoice_mode !== 'production') {
        return NextResponse.json({ error: 'invoice_mode muss test oder production sein.' }, { status: 400 });
      }
      const { data: current, error: readErr } = await supabase
        .from('system_settings')
        .select('id, invoice_mode')
        .eq('id', 1)
        .single();
      if (readErr || !current) {
        return NextResponse.json({ error: 'Einstellungen nicht gefunden.' }, { status: 404 });
      }
      if (current.invoice_mode === invoice_mode) {
        return NextResponse.json({ success: true, invoice_mode });
      }
      const { error: updErr } = await supabase
        .from('system_settings')
        .update({ invoice_mode, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

      await supabase.from('audit_log').insert({
        action: 'admin_invoice_mode_changed',
        entity_type: 'system_settings',
        entity_id: '00000000-0000-0000-0000-000000000001',
        old_data: { invoice_mode: current.invoice_mode },
        new_data: { invoice_mode },
        performed_by: auth.user.id,
      });
      return NextResponse.json({ success: true, invoice_mode });
    }

    return NextResponse.json({ error: `Unbekannte Aktion: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[admin/system-actions]', err);
    return NextResponse.json({ error: 'Aktion fehlgeschlagen.' }, { status: 500 });
  }
}
