import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireAdmin } from '@/lib/apiAuth';
import { buildPayoutExport, listPayoutsWithCheck } from '@/lib/payoutExport';
import { buildPayoutPdf } from '@/lib/payoutPdf';
import { buildPayoutXlsx } from '@/lib/payoutXlsx';

/**
 * Export "pro Auszahlung" (see src/lib/payoutExport.ts).
 *   GET  ?limit=60      → list of payouts with the Netto-vs-Auszahlung check
 *   POST { payout_id, format?: 'csv' | 'pdf' | 'xlsx' }
 *                       → { csv, filename, summary } or { pdf_base64 | xlsx_base64, filename, summary } for ONE payout
 * Admin only. The Zahlungsgebühren export (export-stripe-fees) is untouched.
 */

export const maxDuration = 60;

function getStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function getAdminSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '60');
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 60;
    const payouts = await listPayoutsWithCheck(getStripeClient(), limit);
    return NextResponse.json({ payouts });
  } catch (err: unknown) {
    console.error('Stripe payout list error:', err);
    const message = err instanceof Error ? err.message : 'Laden fehlgeschlagen';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;
    const { payout_id, format } = await req.json();
    if (typeof payout_id !== 'string' || !/^po_[A-Za-z0-9]+$/.test(payout_id)) {
      return NextResponse.json({ error: 'payout_id (po_…) fehlt' }, { status: 400 });
    }
    if (format !== undefined && format !== 'csv' && format !== 'pdf' && format !== 'xlsx') {
      return NextResponse.json({ error: "format muss 'csv', 'pdf' oder 'xlsx' sein" }, { status: 400 });
    }
    const { csv, filename, summary, rows } = await buildPayoutExport(getStripeClient(), getAdminSupabase(), payout_id);
    if (format === 'pdf') {
      const pdf = await buildPayoutPdf(summary, rows);
      return NextResponse.json({ pdf_base64: Buffer.from(pdf).toString('base64'), filename: filename.replace(/\.csv$/, '.pdf'), summary });
    }
    if (format === 'xlsx') {
      const xlsx = await buildPayoutXlsx(summary, rows);
      return NextResponse.json({ xlsx_base64: Buffer.from(xlsx).toString('base64'), filename: filename.replace(/\.csv$/, '.xlsx'), summary });
    }
    return NextResponse.json({ csv, filename, summary });
  } catch (err: unknown) {
    console.error('Stripe payout export error:', err);
    const message = err instanceof Error ? err.message : 'Export fehlgeschlagen';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
