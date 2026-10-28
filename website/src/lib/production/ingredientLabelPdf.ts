/**
 * Ingredient label as PDF (owner, 28.10.2026): for a delivery outside the shop
 * (gifts, B2B thank-yous) a sheet with the logo, the product name, the
 * approved ingredient list with the allergens in bold, the allergen line and
 * the cross-contact notice. Everything centred, NO weight. One product per
 * page; A4 portrait so it scales to A5/A3 at the printer. Built in the browser
 * with pdf-lib (same as the invoices), the logo PNG is fetched by the caller.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { TRACE_NOTICE } from '../productInfo.ts';

const A4 = { w: 595.28, h: 841.89 };
const M = 56;
const INK = rgb(0.102, 0.102, 0.102);
const GREY = rgb(0.42, 0.447, 0.502);

// Helvetica (WinAnsi) has no emoji or dashes beyond "-": strip them, tidy spaces.
const glyphs = (s: string) => (s ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '').replace(/\s+/g, ' ');
const clean = (s: string) => glyphs(s).replace(/\s+-\s*$/, '').trim();

export interface LabelProduct { name: string; ingredients: string; allergens: string | null }

interface Run { text: string; bold: boolean }
/** `**Weizen**mehl, Wasser` → runs with bold flags (same markers as the shop). */
function runs(marked: string): Run[] {
  return marked.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) =>
    p.startsWith('**') && p.endsWith('**') ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false });
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Word = { text: string; bold: boolean; italic?: boolean };

/** Break runs into words (a bold allergen stays bold even inside "Weizenmehl"). */
function words(rs: Run[]): Word[] {
  const out: Word[] = [];
  for (const r of rs) {
    const parts = glyphs(r.text).split(' ');       // keep the spaces at run boundaries ("**Ei**, Zucker")
    parts.forEach((p, i) => {
      if (i > 0) out.push({ text: ' ', bold: false });
      if (p) out.push({ text: p, bold: r.bold });
    });
  }
  return out;
}

function fontOf(f: Fonts, w: Word): PDFFont { return w.italic ? f.italic : w.bold ? f.bold : f.regular; }

/** Greedy wrap, then draw each line centred; returns the new y. */
function drawCentered(page: PDFPage, f: Fonts, ws: Word[], size: number, y: number, color = INK, lineH = size * 1.35): number {
  const maxW = A4.w - 2 * M;
  const lines: Word[][] = [[]];
  const width = (line: Word[]) => line.reduce((s, w) => s + fontOf(f, w).widthOfTextAtSize(w.text, size), 0);
  for (const w of ws) {
    const cur = lines[lines.length - 1];
    if (w.text !== ' ' && cur.length && width([...cur, w]) > maxW) {
      while (cur.length && cur[cur.length - 1].text === ' ') cur.pop();
      lines.push([w]);
    } else if (!(w.text === ' ' && cur.length === 0)) cur.push(w);
  }
  for (const line of lines) {
    let x = (A4.w - width(line)) / 2;
    for (const w of line) {
      const font = fontOf(f, w);
      page.drawText(w.text, { x, y, size, font, color });
      x += font.widthOfTextAtSize(w.text, size);
    }
    y -= lineH;
  }
  return y;
}

export async function buildIngredientLabelPdf(products: LabelProduct[], logoPng: ArrayBuffer | Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(products.length === 1 ? `Zutaten ${clean(products[0].name)}` : 'Zutaten');
  doc.setAuthor('Smittenbrot');
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;

  for (const p of products) {
    const page = doc.addPage([A4.w, A4.h]);
    // Measure first (draw on a throwaway page) so the block can sit in the middle of the page.
    const draw = (page: PDFPage, top: number): number => {
      let y = top;
      if (logo) {
        const w = 190, h = (logo.height / logo.width) * w;
        page.drawImage(logo, { x: (A4.w - w) / 2, y: y - h, width: w, height: h });
        y -= h + 44;
      }
      y = drawCentered(page, f, [{ text: clean(p.name), bold: true }], 26, y, INK, 32);
      y -= 18;
      y = drawCentered(page, f, [{ text: 'ZUTATEN', bold: true }], 9, y, GREY, 16);
      y = drawCentered(page, f, words(runs(p.ingredients)), 15, y, INK, 21);
      if (p.allergens?.trim()) {
        y -= 10;
        y = drawCentered(page, f, [{ text: 'Allergene: ', bold: false }, ...words([{ text: p.allergens, bold: true }])], 15, y, INK, 21);
      }
      y -= 22;
      y = drawCentered(page, f, clean(TRACE_NOTICE).split(' ').flatMap((t, i) => (i ? [{ text: ' ', bold: false, italic: true }, { text: t, bold: false, italic: true }] : [{ text: t, bold: false, italic: true }])), 11, y, GREY, 15.5);
      return y;
    };
    const probe = doc.addPage([A4.w, A4.h]);
    const used = A4.h - M - draw(probe, A4.h - M);
    doc.removePage(doc.getPageCount() - 1);
    const top = Math.min(A4.h - M, A4.h - (A4.h - used) / 2 + 20); // centred, nudged up a little
    draw(page, top);
  }
  return doc.save();
}
