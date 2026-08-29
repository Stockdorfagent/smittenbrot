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
 * Admin subscription actions: pause / resume a customer's Abo on their
 * behalf (e.g. the customer asks at the counter, or a pause needs fixing).
 *
 * Delegates to the subscription-engine — the ONE implementation that also
 * deletes the not-yet-charged order on pause and regenerates it on resume.
 * The admin's OWN JWT is forwarded: the engine's ownership guard lets a
 * caller with customers.is_admin act on the owner's behalf. (Deliberately
 * not the service key — the runtime-injected key value differs from ours,
 * so key equality fails across environments.) An audit_log row records
 * which admin acted.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const { subscription_id, action, resume_date } = await req.json();
    if (!subscription_id || (action !== 'pause' && action !== 'resume')) {
      return NextResponse.json(
        { error: 'subscription_id und action (pause|resume) sind erforderlich.' },
        { status: 400 },
      );
    }

    const callerToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/subscription-engine/${action}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${callerToken}`,
        },
        body: JSON.stringify({
          subscription_id,
          ...(action === 'pause' && resume_date ? { resume_date } : {}),
        }),
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (body as { error?: string }).error ?? 'Aktion fehlgeschlagen.' },
        { status: res.status },
      );
    }

    const supabase = getSupabaseAdmin();
    await supabase.from('audit_log').insert({
      action: action === 'pause' ? 'admin_subscription_paused' : 'admin_subscription_resumed',
      entity_type: 'subscription',
      entity_id: subscription_id,
      old_data: null,
      new_data: action === 'pause' ? { resume_date: resume_date ?? null } : {},
      performed_by: auth.user.id,
    });

    return NextResponse.json({ success: true, ...body });
  } catch (err) {
    console.error('[admin/subscriptions]', err);
    return NextResponse.json({ error: 'Aktion fehlgeschlagen.' }, { status: 500 });
  }
}
