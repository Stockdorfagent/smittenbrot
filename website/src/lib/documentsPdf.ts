import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * PDF renderings of the two bookkeeping documents (owner, 27.09.2026), built in
 * the browser from the same data the customer sees on /orders/[id]:
 *   - the Rechnung (the Bestellbestätigung that went out by e-mail and counts as
 *     the invoice), one per paid order with an invoice number
 *   - the Storno-Rechnung (credit note, §14 UStG) for cancelled orders
 * Same wording, same numbers, same seller block as on screen. Used by the
 * Admin → Exporte ZIP export. Helvetica (WinAnsi) covers ä ö ü ß €.
 */
export interface SellerInfo {
  name: string; address_line1: string; address_line2?: string | null; postal_code: string; city: string;
  vat_id?: string | null; email: string;
}
export interface InvoiceOrder {
  id: string; order_number: string | null; invoice_number: string | null; customer_name: string | null;
  customer_email: string | null; created_at: string; fulfillment_date: string; total_cents: number;
  discount_cents?: number | null; discount_code?: string | null; payment_status: string;
  payment_method_label?: string | null;
  pickup_location_name?: string | null;
  items: { product_name: string; quantity: number; unit_gross_cents: number }[];
}
export interface CreditNoteDoc {
  credit_note_number: string; original_invoice_number: string; total_gross_cents: number;
  total_net_cents: number; total_vat_cents: number; reason: string; created_at: string;
  customer_name: string | null; customer_email: string | null; order_number: string | null;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 56; // margin
const RED = rgb(0.973, 0.071, 0.055);
const INK = rgb(0.102, 0.102, 0.102);
const GREY = rgb(0.42, 0.447, 0.502);
const LINE = rgb(0.85, 0.85, 0.85);

const eur = (c: number) => `${((c ?? 0) / 100).toFixed(2).replace('.', ',')} €`;
const de = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
// Helvetica has no glyph for a few characters that can appear in names/notes.
const clean = (s: string) => (s ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');

interface Ctx { page: PDFPage; font: PDFFont; bold: PDFFont; y: number }
/** Optional logo bytes (PNG) for the top-left corner; fetched by the caller (browser: /small-logo.png). */
export type LogoPng = Uint8Array | ArrayBuffer | null | undefined;

function text(ctx: Ctx, s: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; right?: number } = {}) {
  const f = opts.bold ? ctx.bold : ctx.font;
  const str = clean(s);
  const w = f.widthOfTextAtSize(str, size);
  const xx = opts.right != null ? opts.right - w : x;
  ctx.page.drawText(str, { x: xx, y: ctx.y, size, font: f, color: opts.color ?? INK });
}
function line(ctx: Ctx, y: number, color = LINE) {
  ctx.page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color });
}
async function header(
  ctx: Ctx, title: string, number: string, seller: SellerInfo, customer: { name: string; email: string },
  dateLines: string[], logo?: LogoPng,
) {
  ctx.y = A4.h - M;
  // Logo top-left (falls back to the seller name when no image was supplied).
  if (logo) {
    try {
      const img = await ctx.page.doc.embedPng(logo);
      const h = 44; const w = (img.width / img.height) * h;
      ctx.page.drawImage(img, { x: M - 4, y: ctx.y - h + 12, width: w, height: h });
    } catch { text(ctx, seller.name, M, 11, { bold: true }); }
  } else {
    text(ctx, seller.name, M, 11, { bold: true });
  }
  text(ctx, title, M, 20, { bold: true, right: A4.w - M });
  ctx.y -= 16;
  text(ctx, number, M, 11, { color: RED, bold: true, right: A4.w - M });
  // Dates right under the number — where a reader looks for them.
  for (const dl of dateLines) { ctx.y -= 13; text(ctx, dl, M, 8.5, { color: GREY, right: A4.w - M }); }
  ctx.y -= 26;
  const top = ctx.y;
  text(ctx, 'VERKÄUFER', M, 7.5, { color: GREY }); ctx.y -= 13;
  // Company · owner first, then the address (the name was only in the corner before).
  const sellerLines = seller.name.includes(' · ') ? seller.name.split(' · ') : [seller.name];
  for (const l of [...sellerLines, seller.address_line1, seller.address_line2 ?? '', `${seller.postal_code} ${seller.city}`.trim(),
                   seller.vat_id ? `USt-IdNr: ${seller.vat_id}` : '', seller.email].filter(Boolean)) {
    text(ctx, l, M, 9.5, { bold: sellerLines.includes(l) }); ctx.y -= 13;
  }
  const bottomLeft = ctx.y;
  ctx.y = top;
  text(ctx, 'KUNDE', M, 7.5, { color: GREY, right: A4.w - M }); ctx.y -= 13;
  text(ctx, customer.name || 'Gast', M, 9.5, { bold: true, right: A4.w - M }); ctx.y -= 13;
  text(ctx, customer.email || '—', M, 9.5, { right: A4.w - M }); ctx.y -= 13;
  ctx.y = Math.min(ctx.y, bottomLeft) - 10;
  line(ctx, ctx.y); ctx.y -= 20;
}
function footer(ctx: Ctx, parts: string[]) {
  ctx.y = M + 4;
  line(ctx, ctx.y + 12);
  text(ctx, parts.join('   ·   '), M, 8, { color: GREY });
}

export async function buildInvoicePdf(order: InvoiceOrder, seller: SellerInfo, logo?: LogoPng): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rechnung ${order.invoice_number ?? ''}`.trim());
  doc.setAuthor(seller.name);
  const page = doc.addPage([A4.w, A4.h]);
  const ctx: Ctx = { page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), y: 0 };
  await header(ctx, 'Rechnung', order.invoice_number ?? '', seller, { name: order.customer_name ?? '', email: order.customer_email ?? '' },
    [`Rechnungsdatum: ${de(order.created_at)}`, `Leistungsdatum: ${de(order.fulfillment_date)}`], logo);

  text(ctx, `Bestellung ${order.order_number ?? ''} · Bestellbestätigung, gilt zugleich als Rechnung`, M, 9, { color: GREY }); ctx.y -= 22;
  // table head
  const cols = { pos: M, name: M + 28, qty: A4.w - M - 190, unit: A4.w - M - 95, total: A4.w - M };
  text(ctx, 'POS.', cols.pos, 7.5, { color: GREY }); text(ctx, 'PRODUKT', cols.name, 7.5, { color: GREY });
  text(ctx, 'MENGE', cols.qty, 7.5, { color: GREY, right: cols.qty }); text(ctx, 'PREIS/STÜCK', cols.unit, 7.5, { color: GREY, right: cols.unit });
  text(ctx, 'GESAMT', cols.total, 7.5, { color: GREY, right: cols.total });
  ctx.y -= 6; line(ctx, ctx.y); ctx.y -= 15;
  order.items.forEach((it, i) => {
    text(ctx, String(i + 1), cols.pos, 9.5, { color: GREY });
    text(ctx, it.product_name, cols.name, 9.5, { bold: true });
    text(ctx, String(it.quantity), cols.qty, 9.5, { right: cols.qty });
    text(ctx, eur(it.unit_gross_cents), cols.unit, 9.5, { right: cols.unit });
    text(ctx, eur(it.unit_gross_cents * it.quantity), cols.total, 9.5, { bold: true, right: cols.total });
    ctx.y -= 8; line(ctx, ctx.y, rgb(0.93, 0.93, 0.93)); ctx.y -= 15;
  });
  // summary (same maths as the customer page: VAT out of the charged gross)
  const gross = order.total_cents; const net = Math.round(gross / 1.07); const vat = gross - net;
  ctx.y -= 6; line(ctx, ctx.y + 8);
  const lx = A4.w - M - 200;
  text(ctx, 'Nettobetrag', lx, 9.5, { color: GREY }); text(ctx, eur(net), lx, 9.5, { right: A4.w - M }); ctx.y -= 15;
  text(ctx, 'MwSt. (7 %)', lx, 9.5, { color: GREY }); text(ctx, eur(vat), lx, 9.5, { right: A4.w - M }); ctx.y -= 15;
  if ((order.discount_cents ?? 0) > 0) {
    text(ctx, `Rabatt (${order.discount_code ?? ''})`, lx, 9.5, { color: GREY }); text(ctx, `-${eur(order.discount_cents ?? 0)}`, lx, 9.5, { right: A4.w - M }); ctx.y -= 15;
  }
  ctx.page.drawLine({ start: { x: lx, y: ctx.y + 10 }, end: { x: A4.w - M, y: ctx.y + 10 }, thickness: 0.6, color: LINE }); ctx.y -= 4;
  text(ctx, 'Gesamtsumme', lx, 11, { bold: true }); text(ctx, eur(gross), lx, 11, { bold: true, right: A4.w - M });
  ctx.y -= 30;
  if (order.pickup_location_name) { text(ctx, `Abholung: ${order.pickup_location_name}, ${de(order.fulfillment_date)}`, M, 9, { color: GREY }); ctx.y -= 14; }
  footer(ctx, [`Zahlungsstatus: ${order.payment_status === 'paid' ? 'Bezahlt' : order.payment_status}`,
               ...(order.payment_method_label ? [`Zahlungsart: ${order.payment_method_label}`] : [])]);
  return doc.save();
}

export async function buildCreditNotePdf(cn: CreditNoteDoc, seller: SellerInfo, logo?: LogoPng): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Storno-Rechnung ${cn.credit_note_number}`);
  doc.setAuthor(seller.name);
  const page = doc.addPage([A4.w, A4.h]);
  const ctx: Ctx = { page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), y: 0 };
  await header(ctx, 'Storno-Rechnung', cn.credit_note_number, seller, { name: cn.customer_name ?? '', email: cn.customer_email ?? '' },
    [`Datum: ${de(cn.created_at)}`], logo);
  text(ctx, `zu Original-Rechnung ${cn.original_invoice_number}${cn.order_number ? ` · Bestellung ${cn.order_number}` : ''}`, M, 9.5); ctx.y -= 30;
  const lx = A4.w - M - 200;
  text(ctx, 'Nettobetrag', lx, 9.5, { color: GREY }); text(ctx, `-${eur(cn.total_net_cents)}`, lx, 9.5, { right: A4.w - M }); ctx.y -= 15;
  text(ctx, 'MwSt. (7 %)', lx, 9.5, { color: GREY }); text(ctx, `-${eur(cn.total_vat_cents)}`, lx, 9.5, { right: A4.w - M }); ctx.y -= 15;
  ctx.page.drawLine({ start: { x: lx, y: ctx.y + 10 }, end: { x: A4.w - M, y: ctx.y + 10 }, thickness: 0.6, color: LINE }); ctx.y -= 4;
  text(ctx, 'Gesamtsumme', lx, 11, { bold: true }); text(ctx, `-${eur(cn.total_gross_cents)}`, lx, 11, { bold: true, right: A4.w - M });
  ctx.y -= 36;
  text(ctx, `Grund: ${cn.reason}`, M, 9.5); ctx.y -= 16;
  text(ctx, `Stornorechnung gemäß §14 UStG. Diese Gutschrift hebt die ursprüngliche Rechnung ${cn.original_invoice_number} auf.`, M, 9, { color: GREY });
  footer(ctx, ['Stornorechnung gemäß §14 UStG']);
  return doc.save();
}
