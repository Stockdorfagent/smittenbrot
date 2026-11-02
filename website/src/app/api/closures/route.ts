import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';

const EDGE_FN_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/closure-handler`;

/**
 * Closures: thin proxy in front of the closure-handler edge function.
 *
 * 02.11.2026 (code review findings 4 + 7):
 * - The edge function OWNS the closure row. This route used to insert the row
 *   itself and then call /create, which inserted it again (and /delete only
 *   knew one of the two ids); the handler's response was never read.
 * - create/delete forward the admin's OWN JWT. The edge function now checks
 *   its caller (service key, cron secret or a user with customers.is_admin);
 *   the Vercel-held service key is deliberately not used — the runtime-injected
 *   key value differs from ours, so key equality fails across environments.
 * - 'active' stays a public read (site-wide banner); the function's /active
 *   route is public too.
 */
export async function POST(req: NextRequest) {
  try {
    const { action, closure_id, start_date, end_date, reason, banner_text_de } = await req.json();

    if (action === 'create' || action === 'delete') {
      const auth = await requireAdmin(req);
      if ('response' in auth) return auth.response;

      const callerToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const res = await fetch(`${EDGE_FN_URL}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${callerToken}` },
        body: JSON.stringify(
          action === 'create'
            ? { start_date, end_date, reason: reason || null, banner_text_de: banner_text_de || null }
            : { closure_id },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        console.error(`[closures] ${action} failed:`, res.status, JSON.stringify(body));
        return NextResponse.json(
          { error: typeof body.error === 'string' ? body.error : 'Aktion fehlgeschlagen.' },
          { status: res.status },
        );
      }
      return action === 'create'
        ? NextResponse.json({
            id: body.closure_id,
            subscriptions_paused: body.subscriptions_paused ?? 0,
            ...(body.warning ? { warning: body.warning } : {}),
          })
        : NextResponse.json({ success: true, subscriptions_resumed: body.subscriptions_resumed ?? 0 });
    }

    if (action === 'active') {
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const res = await fetch(`${EDGE_FN_URL}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
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
