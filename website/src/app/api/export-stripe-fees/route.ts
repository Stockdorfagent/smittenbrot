import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireAdmin } from '@/lib/apiAuth';

/**
 * Zahlungsgebühren export (Stripe + PayPal) — one CSV line per Stripe balance
 * transaction, plus a per-day block and a total block.
 *
 * Why per transaction and why two fee columns: PayPal payments run through
 * Stripe, but PayPal's own fee is only PASSED THROUGH by Stripe
 * (`payment_method_passthrough_fee`) and is NOT on Stripe's monthly tax
 * invoice — PayPal issues its own documents. Bookkeeping therefore needs the
 * Stripe part and the PayPal part separately, matched to an invoice number.
 *
 * Payouts (`payout` transactions) are listed for completeness but NEVER summed
 * into Brutto/Netto — they move money to the bank, they are not revenue.
 * Dates are Europe/Berlin calendar days, not UTC.
 */

function getStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Europe/Berlin YYYY-MM-DD and HH:MM for a unix timestamp (seconds). */
function berlinParts(unix: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Unix seconds for a Europe/Berlin calendar date at 00:00 or 23:59:59. */
function berlinBoundary(ymd: string, endOfDay: boolean): number {
  const [y, m, d] = ymd.split('-').map(Number);
  // Berlin is UTC+1 or UTC+2; try both and keep the one that maps back to the
  // requested calendar day (handles DST without a tz library).
  for (const offsetH of [2, 1]) {
    const guess = Date.UTC(y, m - 1, d, (endOfDay ? 23 : 0) - offsetH, endOfDay ? 59 : 0, endOfDay ? 59 : 0) / 1000;
    if (berlinParts(guess).date === ymd) return guess;
  }
  return Date.UTC(y, m - 1, d, endOfDay ? 22 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0) / 1000;
}

const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

const TYPE_LABELS: Record<string, string> = {
  charge: 'Zahlung',
  payment: 'Zahlung',
  refund: 'Erstattung',
  payment_refund: 'Erstattung',
  payment_failure_refund: 'Erstattung (fehlgeschlagene Zahlung)',
  payout: 'Auszahlung',
  payout_cancel: 'Auszahlung storniert',
  payout_failure: 'Auszahlung fehlgeschlagen',
  adjustment: 'Korrektur / Reklamation',
  stripe_fee: 'Stripe-Gebühr',
  application_fee: 'Plattformgebühr',
  transfer: 'Transfer',
};

const PM_LABELS: Record<string, string> = {
  card: 'Karte',
  paypal: 'PayPal',
  link: 'Link',
  sepa_debit: 'SEPA-Lastschrift',
};

/** Balance transaction types that count as revenue movement (Brutto/Netto). */
const REVENUE_TYPES = new Set([
  'charge', 'payment', 'refund', 'payment_refund', 'payment_failure_refund', 'adjustment',
]);

type Row = {
  date: string; time: string; type: string; typeLabel: string; pm: string;
  orderNumber: string; invoiceNumber: string; customer: string;
  gross: number; stripeFee: number; paypalFee: number; otherFee: number; fee: number; net: number;
  id: string; sourceId: string;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const { from_date, to_date } = await req.json();
    if (!from_date) {
      return NextResponse.json({ error: 'from_date is required' }, { status: 400 });
    }

    const fromTimestamp = berlinBoundary(from_date, false);
    const toTimestamp = to_date ? berlinBoundary(to_date, true) : Math.floor(Date.now() / 1000);

    const stripe = getStripeClient();
    const all: Stripe.BalanceTransaction[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const batch = await stripe.balanceTransactions.list({
        limit: 100,
        created: { gte: fromTimestamp, lte: toTimestamp },
        expand: ['data.source'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      all.push(...batch.data);
      if (!batch.has_more || batch.data.length === 0) break;
      startingAfter = batch.data[batch.data.length - 1].id;
    }

    // Match every charge/refund to its order via the PaymentIntent id.
    const piIds = new Set<string>();
    const piOf = (t: Stripe.BalanceTransaction): string => {
      const s = t.source as Stripe.Charge | Stripe.Refund | Stripe.Payout | string | null;
      if (!s || typeof s === 'string') return '';
      const pi = (s as Stripe.Charge | Stripe.Refund).payment_intent;
      return typeof pi === 'string' ? pi : pi?.id ?? '';
    };
    for (const t of all) { const pi = piOf(t); if (pi) piIds.add(pi); }

    const orderByPi = new Map<string, { order_number: string | null; invoice_number: string | null; customer_name: string | null; payment_method: string | null }>();
    if (piIds.size > 0) {
      const { data: orders } = await getAdminSupabase()
        .from('orders')
        .select('stripe_payment_intent_id, order_number, invoice_number, customer_name, payment_method')
        .in('stripe_payment_intent_id', Array.from(piIds));
      for (const o of orders ?? []) {
        if (o.stripe_payment_intent_id) orderByPi.set(o.stripe_payment_intent_id, o);
      }
    }

    const rows: Row[] = all.map((t) => {
      const { date, time } = berlinParts(t.created);
      let stripeFee = 0, paypalFee = 0, otherFee = 0;
      for (const f of t.fee_details ?? []) {
        if (f.type === 'stripe_fee') stripeFee += f.amount;
        else if (f.type === 'payment_method_passthrough_fee' || /paypal/i.test(f.description ?? '')) paypalFee += f.amount;
        else otherFee += f.amount;
      }
      const s = t.source as Stripe.Charge | Stripe.Refund | Stripe.Payout | string | null;
      const sourceId = typeof s === 'string' ? s : s?.id ?? '';
      const order = orderByPi.get(piOf(t));
      // Payment method: from the charge itself; for refunds via the order row.
      let pmRaw = '';
      if (s && typeof s !== 'string' && (s as Stripe.Charge).object === 'charge') {
        pmRaw = (s as Stripe.Charge).payment_method_details?.type ?? '';
      }
      if (!pmRaw && order?.payment_method) pmRaw = order.payment_method.split('/')[0];
      const pm = pmRaw ? (PM_LABELS[pmRaw] ?? pmRaw) : '';
      return {
        date, time, type: t.type,
        typeLabel: TYPE_LABELS[t.type] ?? t.type,
        pm,
        orderNumber: order?.order_number ?? '',
        invoiceNumber: order?.invoice_number ?? '',
        customer: order?.customer_name ?? '',
        gross: t.amount, stripeFee, paypalFee, otherFee, fee: t.fee, net: t.net,
        id: t.id, sourceId,
      };
    }).sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));

    // Per-day and total aggregates over REVENUE transactions only.
    type Agg = { n: number; gross: number; stripeFee: number; paypalFee: number; otherFee: number; fee: number; net: number; payouts: number };
    const empty = (): Agg => ({ n: 0, gross: 0, stripeFee: 0, paypalFee: 0, otherFee: 0, fee: 0, net: 0, payouts: 0 });
    const daily = new Map<string, Agg>();
    const total = empty();
    const add = (a: Agg, r: Row) => {
      if (REVENUE_TYPES.has(r.type)) {
        a.n++; a.gross += r.gross; a.stripeFee += r.stripeFee; a.paypalFee += r.paypalFee;
        a.otherFee += r.otherFee; a.fee += r.fee; a.net += r.net;
      } else if (r.type === 'payout') {
        a.payouts += -r.gross;
      }
    };
    for (const r of rows) {
      if (!daily.has(r.date)) daily.set(r.date, empty());
      add(daily.get(r.date)!, r); add(total, r);
    }

    const esc = (v: string | number) => {
      const str = String(v ?? '');
      return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const line = (cells: (string | number)[]) => cells.map(esc).join(';');
    const de = (ymd: string) => ymd.split('-').reverse().join('.');

    const lines: string[] = [];
    lines.push(line([
      'Datum', 'Uhrzeit', 'Art', 'Zahlungsart', 'Bestellnummer', 'Rechnungsnummer', 'Kunde',
      'Brutto (€)', 'Stripe-Gebühr (€)', 'PayPal-Gebühr (€)', 'Sonstige Gebühr (€)', 'Gebühren gesamt (€)', 'Netto (€)',
      'Stripe-Transaktion', 'Stripe-Quelle',
    ]));
    for (const r of rows) {
      lines.push(line([
        de(r.date), r.time, r.typeLabel, r.pm, r.orderNumber, r.invoiceNumber, r.customer,
        euro(r.gross), euro(r.stripeFee), euro(r.paypalFee), euro(r.otherFee), euro(r.fee), euro(r.net),
        r.id, r.sourceId,
      ]));
    }

    lines.push('');
    lines.push(line(['TAGESSUMMEN (nur Zahlungen/Erstattungen/Korrekturen; Auszahlungen separat)']));
    lines.push(line(['Datum', 'Transaktionen', 'Brutto (€)', 'Stripe-Gebühr (€)', 'PayPal-Gebühr (€)', 'Sonstige Gebühr (€)', 'Gebühren gesamt (€)', 'Netto (€)', 'Auszahlungen an Bank (€)']));
    for (const [d, a] of Array.from(daily.entries()).sort(([x], [y]) => x.localeCompare(y))) {
      lines.push(line([de(d), a.n, euro(a.gross), euro(a.stripeFee), euro(a.paypalFee), euro(a.otherFee), euro(a.fee), euro(a.net), euro(a.payouts)]));
    }
    lines.push(line(['GESAMT', total.n, euro(total.gross), euro(total.stripeFee), euro(total.paypalFee), euro(total.otherFee), euro(total.fee), euro(total.net), euro(total.payouts)]));
    lines.push('');
    lines.push(line(['Hinweis: Stripe-Gebühren stehen auf der Stripe-Rechnung; PayPal-Gebühren sind durchgereicht und stehen NUR auf den PayPal-Belegen (PayPal-Konto → Berichte).']));

    const csvContent = '﻿' + lines.join('\r\n');

    return NextResponse.json({
      csv: csvContent,
      filename: `zahlungsgebuehren-${from_date}-${to_date || 'bis'}.csv`,
      summary: {
        transactions: total.n,
        total_gross_cents: total.gross,
        total_fee_cents: total.fee,
        stripe_fee_cents: total.stripeFee,
        paypal_fee_cents: total.paypalFee,
        total_net_cents: total.net,
        payouts_cents: total.payouts,
        days: daily.size,
      },
    });
  } catch (err: unknown) {
    console.error('Stripe fee export error:', err);
    const message = err instanceof Error ? err.message : 'Export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
