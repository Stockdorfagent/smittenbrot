import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireAdmin } from '@/lib/apiAuth';

/**
 * Abandoned one-time checkouts of the last 7 days, straight from Stripe
 * (owner, 28.09.2026): PaymentIntents that never completed, with name, amount,
 * whether the person paid on a later attempt, and whether the reminder mail
 * went out (abandoned-checkouts edge function marks the PI's metadata).
 * Read-only; admin only.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const list = await stripe.paymentIntents.list({ created: { gte: since }, limit: 100 });
    const paidLater = new Map<string, number>();
    for (const p of list.data) {
      const e = (p.metadata?.customer_email ?? '').toLowerCase();
      if (p.status === 'succeeded' && e) paidLater.set(e, Math.max(paidLater.get(e) ?? 0, p.created));
    }
    const rows = list.data
      .filter((p) => {
        const e = (p.metadata?.customer_email ?? '').toLowerCase();
        return e && !e.endsWith('@smittenbrot-test.de') && !e.startsWith('google-review@')
          && p.metadata?.items && !p.metadata?.subscription_id
          && p.status !== 'succeeded' && p.status !== 'canceled';
      })
      .map((p) => {
        const e = (p.metadata?.customer_email ?? '').toLowerCase();
        return {
          id: p.id,
          created: p.created,
          name: p.metadata?.customer_name ?? '',
          email: e,
          amount: p.amount,
          fulfillment_date: p.metadata?.fulfillment_date ?? null,
          status: p.status,
          paid_later: (paidLater.get(e) ?? 0) > p.created,
          mailed_at: p.metadata?.abandoned_mail_sent ?? null,
        };
      })
      .sort((a, b) => b.created - a.created);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
