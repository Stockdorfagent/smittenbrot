/**
 * PDF twin of the "pro Auszahlung" CSV (owner, 26.10.2026): A4 landscape,
 * header "Smittenbrot – Stripe-Auszahlung <Datum>" + Payout-ID, one table row
 * per transaction, then the AUSZAHLUNG block with all totals and the
 * Kontrolle line. Same data as the CSV (`buildPayoutExport`), same file name
 * with `.pdf`. Built with pdf-lib like documentsPdf.ts (Rechnung / Storno);
 * Helvetica covers ä ö ü ß €. Works in node (route) and in the browser.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { PAYOUT_STATUS_LABELS, type PayoutRow, type PayoutSummary } from './payoutExport.ts';
import { euro } from './payoutSplit.ts';

const PAGE = { w: 841.89, h: 595.28 }; // A4 landscape
const M = 24;
const RED = rgb(0.973, 0.071, 0.055);
const INK = rgb(0.102, 0.102, 0.102);
const GREY = rgb(0.42, 0.447, 0.502);
const LINE = rgb(0.85, 0.85, 0.85);
const ZEBRA = rgb(0.965, 0.965, 0.965);

const eur = (c: number) => `${euro(c)} €`;
const de = (ymd: string) => ymd.split('-').reverse().join('.');
// Helvetica (WinAnsi) lacks a few glyphs; dashes become "-" like in documentsPdf.
const clean = (s: string) => (s ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');

type Col = { key: keyof PayoutRow | 'b7' | 'b19'; label: string; w: number; right?: boolean };
const COLS: Col[] = [
  { key: 'date', label: 'Datum', w: 46 },
  { key: 'time', label: 'Uhrzeit', w: 32 },
  { key: 'typeLabel', label: 'Art', w: 52 },
  { key: 'pm', label: 'Zahlungsart', w: 50 },
  { key: 'orderNumber', label: 'Bestellnr.', w: 42 },
  { key: 'invoiceNumber', label: 'Rechnungsnr.', w: 54 },
  { key: 'creditNoteNumber', label: 'Gutschrift-Nr.', w: 78 },
  { key: 'customer', label: 'Kunde', w: 84 },
  { key: 'b7', label: 'Brutto 7 %', w: 46, right: true },
  { key: 'b19', label: 'Brutto 19 %', w: 48, right: true },
  { key: 'stripeFee', label: 'Stripe-Geb.', w: 44, right: true },
  { key: 'paypalFee', label: 'PayPal-Geb.', w: 46, right: true },
  { key: 'net', label: 'Netto', w: 46, right: true },
  { key: 'id', label: 'Stripe-Transaktion', w: 0 }, // takes the rest (≈126 pt: a full txn_… id at 7 pt)
];

function cellText(r: PayoutRow, key: Col['key']): string {
  switch (key) {
    case 'date': return de(r.date);
    case 'b7': return r.split ? eur(r.split[7]) : '–';
    case 'b19': return r.split ? eur(r.split[19]) : '–';
    case 'stripeFee': return eur(r.stripeFee);
    case 'paypalFee': return eur(r.paypalFee);
    case 'net': return eur(r.net);
    default: return String(r[key] ?? '');
  }
}

interface Ctx { doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont; y: number; pageNo: number }

function fit(font: PDFFont, s: string, size: number, maxW: number): string {
  let str = clean(s);
  if (font.widthOfTextAtSize(str, size) <= maxW) return str;
  while (str.length > 1 && font.widthOfTextAtSize(str + '…', size) > maxW) str = str.slice(0, -1);
  return str + '…';
}

function text(ctx: Ctx, s: string, x: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; right?: number; maxW?: number } = {}) {
  const f = opts.bold ? ctx.bold : ctx.font;
  const str = opts.maxW != null ? fit(f, s, size, opts.maxW) : clean(s);
  const w = f.widthOfTextAtSize(str, size);
  ctx.page.drawText(str, { x: opts.right != null ? opts.right - w : x, y: ctx.y, size, font: f, color: opts.color ?? INK });
}

function hline(ctx: Ctx, y: number, color = LINE) {
  ctx.page.drawLine({ start: { x: M, y }, end: { x: PAGE.w - M, y }, thickness: 0.6, color });
}

function newPage(ctx: Ctx, summary: PayoutSummary) {
  ctx.page = ctx.doc.addPage([PAGE.w, PAGE.h]);
  ctx.pageNo += 1;
  ctx.y = PAGE.h - M - 6;
  if (ctx.pageNo === 1) {
    text(ctx, `Smittenbrot – Stripe-Auszahlung ${de(summary.arrival_date)}`, M, 16, { bold: true });
    text(ctx, eur(summary.amount_cents), M, 16, { bold: true, right: PAGE.w - M, color: RED });
    ctx.y -= 15;
    text(ctx, `Payout-ID: ${summary.payout_id}   ·   Stripe-Status: ${PAYOUT_STATUS_LABELS[summary.status] ?? summary.status}   ·   erstellt ${de(summary.created)}   ·   ${summary.transactions} Transaktionen`, M, 8.5, { color: GREY });
    ctx.y -= 18;
  } else {
    text(ctx, `Smittenbrot – Stripe-Auszahlung ${de(summary.arrival_date)} · ${summary.payout_id} (Fortsetzung)`, M, 10, { bold: true });
    ctx.y -= 18;
  }
}

function tableHead(ctx: Ctx) {
  let x = M;
  const lastW = PAGE.w - 2 * M - COLS.reduce((s, c) => s + c.w, 0);
  for (const c of COLS) {
    const w = c.w || lastW;
    text(ctx, c.label.toUpperCase(), x, 6, { color: GREY, right: c.right ? x + w - 3 : undefined });
    x += w;
  }
  ctx.y -= 5; hline(ctx, ctx.y, GREY); ctx.y -= 11;
}

function footer(ctx: Ctx, total: number, summary: PayoutSummary) {
  const y = ctx.y; ctx.y = M - 6;
  hline(ctx, ctx.y + 10);
  text(ctx, `Stripe-Auszahlung ${summary.payout_id} · Export vom ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })} · Stripe-Gebühren stehen auf der Stripe-Rechnung; PayPal-Gebühren sind durchgereicht (PayPal-Belege).`, M, 6.5, { color: GREY });
  text(ctx, `Seite ${ctx.pageNo} / ${total}`, M, 6.5, { color: GREY, right: PAGE.w - M });
  ctx.y = y;
}

export async function buildPayoutPdf(summary: PayoutSummary, rows: PayoutRow[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Stripe-Auszahlung ${de(summary.arrival_date)} ${summary.payout_id}`);
  doc.setAuthor('Smittenbrot');
  const ctx: Ctx = {
    doc, page: null as unknown as PDFPage, pageNo: 0, y: 0,
    font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const ROW_H = 12;
  const bottom = M + 24;

  newPage(ctx, summary);
  tableHead(ctx);
  const lastW = PAGE.w - 2 * M - COLS.reduce((s, c) => s + c.w, 0);
  rows.forEach((r, i) => {
    if (ctx.y < bottom) { newPage(ctx, summary); tableHead(ctx); }
    if (i % 2 === 1) ctx.page.drawRectangle({ x: M, y: ctx.y - 3.5, width: PAGE.w - 2 * M, height: ROW_H, color: ZEBRA });
    let x = M;
    const refund = r.gross < 0;
    for (const c of COLS) {
      const w = c.w || lastW;
      const s = cellText(r, c.key);
      const isMoney = c.right === true;
      text(ctx, s, x, 7, {
        right: c.right ? x + w - 3 : undefined, maxW: w - 4,
        color: isMoney && s.startsWith('-') ? RED : (c.key === 'id' ? GREY : INK),
        bold: c.key === 'net' || (c.key === 'typeLabel' && refund),
      });
      x += w;
    }
    ctx.y -= ROW_H;
  });
  if (rows.length === 0) { text(ctx, 'Stripe hat keine Transaktionen für diese Auszahlung geliefert.', M, 8, { color: RED }); ctx.y -= ROW_H; }

  // ── AUSZAHLUNG block ──
  const block: [string, string][] = [
    ['Payout-ID', summary.payout_id],
    ['Auszahlungsdatum', de(summary.arrival_date)],
    ['Auszahlungsbetrag', eur(summary.amount_cents)],
    ['Stripe-Status', PAYOUT_STATUS_LABELS[summary.status] ?? summary.status],
    ['Transaktionen', String(summary.transactions)],
    ['Summe Brutto', eur(summary.gross_cents)],
    ['Summe Brutto 7 %', eur(summary.gross_7_cents)],
    ['Summe Brutto 19 %', eur(summary.gross_19_cents)],
    ...(summary.gross_other_cents !== 0 ? [['Summe Brutto anderer MwSt-Satz', eur(summary.gross_other_cents)] as [string, string]] : []),
    ...(summary.gross_unmatched_cents !== 0 ? [['Summe Brutto ohne Bestellzuordnung', eur(summary.gross_unmatched_cents)] as [string, string]] : []),
    ['Summe Stripe-Gebühren', eur(summary.stripe_fee_cents)],
    ['Summe PayPal-Gebühren', eur(summary.paypal_fee_cents)],
    ...(summary.other_fee_cents !== 0 ? [['Summe Sonstige Gebühren', eur(summary.other_fee_cents)] as [string, string]] : []),
    ['Summe Netto', eur(summary.net_cents)],
  ];
  const needed = 30 + (block.length + 2 + summary.warnings.length) * 12;
  if (ctx.y - needed < bottom) newPage(ctx, summary);
  ctx.y -= 10; hline(ctx, ctx.y + 6); ctx.y -= 8;
  text(ctx, 'AUSZAHLUNG', M, 9, { bold: true }); ctx.y -= 14;
  const labelX = M, valueRight = M + 300;
  for (const [k, v] of block) {
    const strong = k === 'Auszahlungsbetrag' || k === 'Summe Netto';
    text(ctx, k, labelX, 8, { color: strong ? INK : GREY, bold: strong });
    text(ctx, v, labelX, 8, { right: valueRight, bold: strong });
    ctx.y -= 12;
  }
  ctx.y -= 2;
  text(ctx, 'Kontrolle', labelX, 8.5, { bold: true });
  text(ctx, summary.ok ? 'OK – Summe Netto = Auszahlungsbetrag' : 'NICHT OK – siehe Warnung', labelX, 8.5, { right: valueRight, bold: true, color: summary.ok ? INK : RED });
  ctx.y -= 12;
  for (const w of summary.warnings) { text(ctx, `WARNUNG: ${w}`, labelX, 7.5, { color: RED, maxW: PAGE.w - 2 * M }); ctx.y -= 11; }

  const pages = doc.getPages();
  pages.forEach((p, i) => { ctx.page = p; ctx.pageNo = i + 1; footer(ctx, pages.length, summary); });
  return doc.save();
}
