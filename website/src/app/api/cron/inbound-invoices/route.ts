import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/production/api';
import { pollInbox } from '@/lib/production/inboundInvoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET|POST /api/cron/inbound-invoices — called every 5 minutes by Supabase pg_cron
 * (migration 043) with `Authorization: Bearer <CRON_SECRET>` (the vault's cron_secret).
 * Polls belege@smittenbrot.de over IMAP and turns forwarded invoices into draft deliveries.
 */
async function run(req: NextRequest) {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || bearer !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { IMAP_USER, IMAP_PASSWORD, IMAP_HOST, INVOICE_ALLOWED_SENDERS, ANTHROPIC_API_KEY } = process.env;
  if (!IMAP_USER || !IMAP_PASSWORD || !INVOICE_ALLOWED_SENDERS || !ANTHROPIC_API_KEY) return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  try {
    const r = await pollInbox(serviceClient(), { host: IMAP_HOST, user: IMAP_USER, password: IMAP_PASSWORD, allowedSenders: INVOICE_ALLOWED_SENDERS });
    if (r.seen) console.log('inbound invoices:', JSON.stringify({ seen: r.seen, ignored: r.ignored, processed: r.processed.map((p) => ({ subject: p.subject, results: p.results.map((x) => ({ file: x.filename, draft: x.draft_id, error: x.error })) })) }));
    return NextResponse.json(r);
  } catch (e) {
    console.error('inbound invoices failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
