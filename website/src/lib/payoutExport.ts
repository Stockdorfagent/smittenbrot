/**
 * Export "pro Auszahlung": ONE CSV per Stripe payout with exactly the balance
 * transactions Stripe paid out in it, matched to our orders (number, invoice,
 * customer, payment method, VAT split), so the owner can attach the file to
 * the bank booking in Papierkram.
 *
 * Why not a date range: Stripe pays out with a delay and groups whatever
 * settled by its cut-off, so a calendar range never matches the bank line.
 * Stripe answers `GET /v1/balance_transactions?payout=po_…` with the
 * transactions of an AUTOMATIC payout (the payout's own transaction included,
 * which we leave out of the rows). Check: Σ Netto of the rows must equal the
 * payout amount — if not, the file and the admin say so loudly.
 *
 * Deliberately a sibling of `api/export-stripe-fees` (the Zahlungsgebühren
 * export), which stays untouched: same CSV dialect (semicolon, German decimals,
 * UTF-8 BOM, CRLF), same columns plus Gutschrift-Nr. and Brutto 7 % / 19 %.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentMethodLabel } from './adminLabels.ts';
import { emptySplit, euro, orderGrossSplit, splitTransactionAmount, type GrossSplit, type OrderItemLike } from './payoutSplit.ts';

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

const de = (ymd: string) => ymd.split('-').reverse().join('.');

const TYPE_LABELS: Record<string, string> = {
  charge: 'Zahlung',
  payment: 'Zahlung',
  refund: 'Erstattung',
  payment_refund: 'Erstattung',
  payment_failure_refund: 'Erstattung (fehlgeschlagene Zahlung)',
  payout_cancel: 'Auszahlung storniert',
  payout_failure: 'Auszahlung fehlgeschlagen',
  adjustment: 'Korrektur / Reklamation',
  stripe_fee: 'Stripe-Gebühr',
  application_fee: 'Plattformgebühr',
  transfer: 'Transfer',
};

export const PAYOUT_STATUS_LABELS: Record<string, string> = {
  paid: 'Ausgezahlt',
  pending: 'Ausstehend',
  in_transit: 'Unterwegs',
  canceled: 'Storniert',
  failed: 'Fehlgeschlagen',
};

export type PayoutRow = {
  date: string; time: string; type: string; typeLabel: string; pm: string;
  orderNumber: string; invoiceNumber: string; creditNoteNumber: string; customer: string;
  gross: number; split: GrossSplit | null;
  stripeFee: number; paypalFee: number; otherFee: number; fee: number; net: number;
  id: string; sourceId: string;
};

export type PayoutSummary = {
  payout_id: string;
  arrival_date: string;            // YYYY-MM-DD
  created: string;                 // YYYY-MM-DD (Berlin)
  status: string;
  automatic: boolean;
  amount_cents: number;
  transactions: number;
  gross_cents: number;
  gross_7_cents: number;
  gross_19_cents: number;
  gross_other_cents: number;       // rate neither 7 nor 19 (should stay 0)
  gross_unmatched_cents: number;   // rows without an order → no VAT split
  stripe_fee_cents: number;
  paypal_fee_cents: number;
  other_fee_cents: number;
  fee_cents: number;
  net_cents: number;
  difference_cents: number;        // net − payout amount; 0 = OK
  ok: boolean;
  warnings: string[];
};

export type PayoutExport = { csv: string; filename: string; summary: PayoutSummary; rows: PayoutRow[] };

type OrderRow = {
  id: string; stripe_payment_intent_id: string | null; order_number: string | null; invoice_number: string | null;
  customer_name: string | null; payment_method: string | null; total_cents: number;
  order_items: OrderItemLike[] | null;
};

/** All balance transactions of a payout (Stripe's `payout` filter, paginated). */
async function listPayoutTransactions(stripe: Stripe, payoutId: string): Promise<Stripe.BalanceTransaction[]> {
  const all: Stripe.BalanceTransaction[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const batch = await stripe.balanceTransactions.list({
      payout: payoutId,
      limit: 100,
      expand: ['data.source'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...batch.data);
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }
  return all;
}

function piOf(t: Stripe.BalanceTransaction): string {
  const s = t.source as Stripe.Charge | Stripe.Refund | Stripe.Payout | string | null;
  if (!s || typeof s === 'string') return '';
  const pi = (s as Stripe.Charge | Stripe.Refund).payment_intent;
  return typeof pi === 'string' ? pi : pi?.id ?? '';
}

function arrivalYmd(payout: Stripe.Payout): string {
  // arrival_date is a calendar date (midnight UTC) → format in UTC, not Berlin.
  return new Date(payout.arrival_date * 1000).toISOString().slice(0, 10);
}

/**
 * Build the per-payout export. Pure in the sense that it only READS (Stripe +
 * orders/credit_notes); callers decide what to do with the CSV.
 */
export async function buildPayoutExport(stripe: Stripe, db: SupabaseClient, payoutId: string): Promise<PayoutExport> {
  const payout = await stripe.payouts.retrieve(payoutId);
  const txns = (await listPayoutTransactions(stripe, payoutId)).filter((t) => t.type !== 'payout');
  const warnings: string[] = [];
  if (!payout.automatic) {
    warnings.push('Manuelle Auszahlung: Stripe liefert die enthaltenen Transaktionen nur für automatische Auszahlungen.');
  }

  // ── Match to orders (charges AND refunds via the PaymentIntent) ──
  const piIds = Array.from(new Set(txns.map(piOf).filter(Boolean)));
  const orderByPi = new Map<string, OrderRow>();
  const creditNoteByOrder = new Map<string, string>();
  if (piIds.length > 0) {
    const { data: orders, error } = await db
      .from('orders')
      .select('id, stripe_payment_intent_id, order_number, invoice_number, customer_name, payment_method, total_cents, order_items(quantity, unit_price_cents, unit_price_gross_cents, vat_rate)')
      .in('stripe_payment_intent_id', piIds);
    if (error) throw new Error(`orders: ${error.message}`);
    for (const o of (orders ?? []) as OrderRow[]) {
      if (o.stripe_payment_intent_id) orderByPi.set(o.stripe_payment_intent_id, o);
    }
    const orderIds = Array.from(orderByPi.values()).map((o) => o.id);
    if (orderIds.length > 0) {
      const { data: notes, error: cnErr } = await db
        .from('credit_notes')
        .select('order_id, credit_note_number')
        .in('order_id', orderIds);
      if (cnErr) throw new Error(`credit_notes: ${cnErr.message}`);
      for (const n of notes ?? []) creditNoteByOrder.set(n.order_id, n.credit_note_number);
    }
  }

  const rows: PayoutRow[] = txns.map((t) => {
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
    let pmRaw = '';
    if (s && typeof s !== 'string' && (s as Stripe.Charge).object === 'charge') {
      const pmd = (s as Stripe.Charge).payment_method_details;
      const wallet = pmd?.type === 'card' ? pmd.card?.wallet?.type : undefined;
      pmRaw = pmd?.type ? (wallet ? `${pmd.type}/${wallet}` : pmd.type) : '';
    }
    if (!pmRaw && order?.payment_method) pmRaw = order.payment_method;
    const isRefund = t.type.includes('refund');
    const orderSplit = order ? orderGrossSplit(order.order_items ?? [], order.total_cents) : null;
    return {
      date, time, type: t.type,
      typeLabel: TYPE_LABELS[t.type] ?? t.type,
      pm: paymentMethodLabel(pmRaw),
      orderNumber: order?.order_number ?? '',
      invoiceNumber: order?.invoice_number ?? '',
      creditNoteNumber: isRefund && order ? (creditNoteByOrder.get(order.id) ?? '') : '',
      customer: order?.customer_name ?? '',
      gross: t.amount,
      split: splitTransactionAmount(t.amount, orderSplit),
      stripeFee, paypalFee, otherFee, fee: t.fee, net: t.net,
      id: t.id, sourceId,
    };
  }).sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));

  // ── Sums + check ──
  const sum = emptySplit();
  let gross = 0, unmatched = 0, stripeFee = 0, paypalFee = 0, otherFee = 0, fee = 0, net = 0;
  for (const r of rows) {
    gross += r.gross; stripeFee += r.stripeFee; paypalFee += r.paypalFee; otherFee += r.otherFee; fee += r.fee; net += r.net;
    if (r.split) { sum[7] += r.split[7]; sum[19] += r.split[19]; sum.other += r.split.other; }
    else unmatched += r.gross;
  }
  const difference = net - payout.amount;
  const unmatchedRows = rows.filter((r) => !r.split);
  if (unmatchedRows.length > 0) {
    warnings.push(`${unmatchedRows.length} Transaktion(en) ohne Bestellzuordnung (${euro(unmatched)} € Brutto ohne MwSt-Aufteilung): ${unmatchedRows.map((r) => r.id).join(', ')}`);
  }
  if (sum.other !== 0) {
    warnings.push(`Bruttoanteile mit anderem MwSt-Satz als 7 % / 19 %: ${euro(sum.other)} €`);
  }
  if (difference !== 0) {
    warnings.unshift(`KONTROLLE FEHLGESCHLAGEN: Summe Netto ${euro(net)} € ≠ Auszahlungsbetrag ${euro(payout.amount)} € (Differenz ${euro(difference)} €)`);
  }
  if (txns.length === 0) warnings.push('Stripe hat keine Transaktionen für diese Auszahlung geliefert.');

  const summary: PayoutSummary = {
    payout_id: payout.id,
    arrival_date: arrivalYmd(payout),
    created: berlinParts(payout.created).date,
    status: payout.status,
    automatic: payout.automatic,
    amount_cents: payout.amount,
    transactions: rows.length,
    gross_cents: gross,
    gross_7_cents: sum[7],
    gross_19_cents: sum[19],
    gross_other_cents: sum.other,
    gross_unmatched_cents: unmatched,
    stripe_fee_cents: stripeFee,
    paypal_fee_cents: paypalFee,
    other_fee_cents: otherFee,
    fee_cents: fee,
    net_cents: net,
    difference_cents: difference,
    ok: difference === 0 && txns.length > 0,
    warnings,
  };

  // ── CSV ──
  const esc = (v: string | number) => {
    const str = String(v ?? '');
    return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const line = (cells: (string | number)[]) => cells.map(esc).join(';');
  const lines: string[] = [];
  lines.push(line([
    'Datum', 'Uhrzeit', 'Art', 'Zahlungsart', 'Bestellnummer', 'Rechnungsnummer', 'Gutschrift-Nr.', 'Kunde',
    'Brutto (€)', 'Brutto 7 % (€)', 'Brutto 19 % (€)',
    'Stripe-Gebühr (€)', 'PayPal-Gebühr (€)', 'Sonstige Gebühr (€)', 'Gebühren gesamt (€)', 'Netto (€)',
    'Stripe-Transaktion', 'Stripe-Quelle',
  ]));
  for (const r of rows) {
    lines.push(line([
      de(r.date), r.time, r.typeLabel, r.pm, r.orderNumber, r.invoiceNumber, r.creditNoteNumber, r.customer,
      euro(r.gross), r.split ? euro(r.split[7]) : '', r.split ? euro(r.split[19]) : '',
      euro(r.stripeFee), euro(r.paypalFee), euro(r.otherFee), euro(r.fee), euro(r.net),
      r.id, r.sourceId,
    ]));
  }
  lines.push('');
  lines.push(line(['AUSZAHLUNG']));
  lines.push(line(['Payout-ID', summary.payout_id]));
  lines.push(line(['Auszahlungsdatum', de(summary.arrival_date)]));
  lines.push(line(['Auszahlungsbetrag (€)', euro(summary.amount_cents)]));
  lines.push(line(['Stripe-Status', PAYOUT_STATUS_LABELS[summary.status] ?? summary.status]));
  lines.push(line(['Transaktionen', summary.transactions]));
  lines.push(line(['Summe Brutto (€)', euro(summary.gross_cents)]));
  lines.push(line(['Summe Brutto 7 % (€)', euro(summary.gross_7_cents)]));
  lines.push(line(['Summe Brutto 19 % (€)', euro(summary.gross_19_cents)]));
  if (summary.gross_other_cents !== 0) lines.push(line(['Summe Brutto anderer MwSt-Satz (€)', euro(summary.gross_other_cents)]));
  if (summary.gross_unmatched_cents !== 0) lines.push(line(['Summe Brutto ohne Bestellzuordnung (€)', euro(summary.gross_unmatched_cents)]));
  lines.push(line(['Summe Stripe-Gebühren (€)', euro(summary.stripe_fee_cents)]));
  lines.push(line(['Summe PayPal-Gebühren (€)', euro(summary.paypal_fee_cents)]));
  if (summary.other_fee_cents !== 0) lines.push(line(['Summe Sonstige Gebühren (€)', euro(summary.other_fee_cents)]));
  lines.push(line(['Summe Netto (€)', euro(summary.net_cents)]));
  lines.push(line(['Kontrolle', summary.ok ? 'OK – Summe Netto = Auszahlungsbetrag' : 'NICHT OK – siehe Warnung']));
  for (const w of warnings) lines.push(line(['WARNUNG', w]));
  lines.push('');
  lines.push(line(['Hinweis: Stripe-Gebühren stehen auf der Stripe-Rechnung; PayPal-Gebühren sind durchgereicht und stehen NUR auf den PayPal-Belegen (PayPal-Konto → Berichte).']));

  const csv = '﻿' + lines.join('\r\n');
  const filename = `Stripe-Auszahlung_${summary.arrival_date.replace(/-/g, '')}_${payout.id}.csv`;
  return { csv, filename, summary, rows };
}

export type PayoutListItem = {
  payout_id: string;
  arrival_date: string;
  created: string;
  status: string;
  automatic: boolean;
  amount_cents: number;
  transactions: number;
  net_cents: number;
  difference_cents: number;
  ok: boolean;
  warnings: string[];
};

/**
 * The payout list for the admin: every payout (newest first) with the
 * net-vs-amount check already done, so the owner sees OK / nicht OK before
 * downloading. One Stripe list call per payout; the account has a few dozen.
 */
export async function listPayoutsWithCheck(stripe: Stripe, limit = 60): Promise<PayoutListItem[]> {
  const payouts: Stripe.Payout[] = [];
  let startingAfter: string | undefined;
  while (payouts.length < limit) {
    const batch = await stripe.payouts.list({ limit: Math.min(100, limit - payouts.length), ...(startingAfter ? { starting_after: startingAfter } : {}) });
    payouts.push(...batch.data);
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }
  const out: PayoutListItem[] = [];
  // Sequential on purpose: a few dozen small requests, no Stripe rate-limit worries.
  for (const p of payouts) {
    const dead = p.status === 'canceled' || p.status === 'failed';
    const txns = dead ? [] : (await listPayoutTransactions(stripe, p.id)).filter((t) => t.type !== 'payout');
    const net = txns.reduce((s, t) => s + t.net, 0);
    const difference = net - p.amount;
    const warnings: string[] = [];
    if (!p.automatic) warnings.push('Manuelle Auszahlung');
    if (!dead && txns.length === 0) warnings.push('Keine Transaktionen geliefert');
    if (!dead && difference !== 0) warnings.push(`Differenz ${euro(difference)} €`);
    out.push({
      payout_id: p.id,
      arrival_date: arrivalYmd(p),
      created: berlinParts(p.created).date,
      status: p.status,
      automatic: p.automatic,
      amount_cents: p.amount,
      transactions: txns.length,
      net_cents: net,
      difference_cents: difference,
      ok: !dead && txns.length > 0 && difference === 0,
      warnings,
    });
  }
  return out;
}
