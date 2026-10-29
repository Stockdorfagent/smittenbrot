/**
 * Excel twin of the "pro Auszahlung" CSV (owner, 29.10.2026): same rows as the
 * CSV/PDF, typed cells (dates, € amounts), sheet "Transaktionen" + the
 * AUSZAHLUNG block with the Kontrolle line as a footer. Node only.
 */
import { PAYOUT_STATUS_LABELS, type PayoutRow, type PayoutSummary } from './payoutExport.ts';
import { buildWorkbook, type XlsxSheet } from './xlsx.ts';

export async function buildPayoutXlsx(summary: PayoutSummary, rows: PayoutRow[]): Promise<Uint8Array> {
  const de = (ymd: string) => ymd.split('-').reverse().join('.');
  const sheet: XlsxSheet = {
    name: 'Transaktionen',
    intro: [`Stripe-Auszahlung ${de(summary.arrival_date)} · ${summary.payout_id}`, `Auszahlungsbetrag ${(summary.amount_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} € · Stripe-Status ${PAYOUT_STATUS_LABELS[summary.status] ?? summary.status} · ${summary.transactions} Transaktionen`],
    columns: [
      { header: 'Datum', key: 'date', type: 'date', width: 12 },
      { header: 'Uhrzeit', key: 'time', width: 9 },
      { header: 'Art', key: 'typeLabel', width: 14 },
      { header: 'Zahlungsart', key: 'pm', width: 13 },
      { header: 'Bestellnr.', key: 'orderNumber', width: 11 },
      { header: 'Rechnungsnr.', key: 'invoiceNumber', width: 20 },
      { header: 'Gutschrift-Nr.', key: 'creditNoteNumber', width: 22 },
      { header: 'Kunde', key: 'customer', width: 26 },
      { header: 'Brutto', key: 'gross', type: 'euro', width: 12 },
      { header: 'Brutto 7 %', key: 'b7', type: 'euro', width: 12 },
      { header: 'Brutto 19 %', key: 'b19', type: 'euro', width: 12 },
      { header: 'Stripe-Gebühr', key: 'stripeFee', type: 'euro', width: 14 },
      { header: 'PayPal-Gebühr', key: 'paypalFee', type: 'euro', width: 14 },
      { header: 'Netto', key: 'net', type: 'euro', width: 12 },
      { header: 'Stripe-Transaktion', key: 'id', width: 34 },
    ],
    rows: rows.map((r) => ({ ...r, b7: r.split ? r.split[7] : null, b19: r.split ? r.split[19] : null })),
    footer: [
      ['Payout-ID', summary.payout_id],
      ['Auszahlungsdatum', summary.arrival_date, 'date'],
      ['Auszahlungsbetrag', summary.amount_cents, 'euro'],
      ['Transaktionen', summary.transactions, 'int'],
      ['Summe Brutto', summary.gross_cents, 'euro'],
      ['Summe Brutto 7 %', summary.gross_7_cents, 'euro'],
      ['Summe Brutto 19 %', summary.gross_19_cents, 'euro'],
      ...(summary.gross_other_cents !== 0 ? [['Summe Brutto anderer MwSt-Satz', summary.gross_other_cents, 'euro'] as [string, unknown, 'euro']] : []),
      ...(summary.gross_unmatched_cents !== 0 ? [['Summe Brutto ohne Bestellzuordnung', summary.gross_unmatched_cents, 'euro'] as [string, unknown, 'euro']] : []),
      ['Summe Stripe-Gebühren', summary.stripe_fee_cents, 'euro'],
      ['Summe PayPal-Gebühren', summary.paypal_fee_cents, 'euro'],
      ...(summary.other_fee_cents !== 0 ? [['Summe Sonstige Gebühren', summary.other_fee_cents, 'euro'] as [string, unknown, 'euro']] : []),
      ['Summe Netto', summary.net_cents, 'euro'],
      ['Kontrolle', summary.ok ? 'OK – Summe Netto = Auszahlungsbetrag' : `NICHT OK – ${summary.warnings.join(' / ')}`],
    ],
  };
  return buildWorkbook([sheet]);
}
