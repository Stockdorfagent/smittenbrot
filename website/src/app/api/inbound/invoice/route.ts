import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/production/api';
import { processReceivedEmail, senderAllowed, verifySvix } from '@/lib/production/inboundInvoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/inbound/invoice — Resend webhook (event email.received). Public URL,
 * protected by the Svix signature (RESEND_WEBHOOK_SECRET) and the sender
 * allow-list (INVOICE_ALLOWED_SENDERS). Replies 200 quickly on anything we
 * ignore so Resend does not retry; real failures return 500 (Resend retries).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const ok = verifySvix(process.env.RESEND_WEBHOOK_SECRET ?? '', { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, body);
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  let event: { type?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string } };
  try { event = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (event.type !== 'email.received' || !event.data?.email_id) return NextResponse.json({ ignored: event.type ?? 'unknown' });
  const from = event.data.from ?? '';
  if (!senderAllowed(from, process.env.INVOICE_ALLOWED_SENDERS ?? '')) {
    console.warn('inbound invoice: sender not allowed:', from.replace(/[^@.\w<>\s-]/g, ''));
    return NextResponse.json({ ignored: 'sender' });
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.RESEND_API_KEY) return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  const results = await processReceivedEmail(serviceClient(), event.data.email_id, from, event.data.subject ?? '(ohne Betreff)');
  return NextResponse.json({ ok: true, results: results.map((r) => ({ file: r.filename, draft: r.draft_id, error: r.error })) });
}
