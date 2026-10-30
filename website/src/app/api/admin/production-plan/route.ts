import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import path from 'path';
import { requireAdmin } from '@/lib/apiAuth';
import { paymentMethodLabel, orderStatusAdminLabels } from '@/lib/adminLabels';
import { getBakeSheet } from '@/lib/production/data';
import { addDays } from '@/lib/production/bakeDays';
import type { ProductQty } from '@/lib/production/types';

/**
 * GET /api/admin/production-plan?from=YYYY-MM-DD[&to=YYYY-MM-DD]
 *
 * The owner's Excel production plan, reduced to two tabs (owner, 30.10.2026):
 *   Overview — what is actually baked, from the BAKE SHEET of each day in the
 *              range (shop orders + B2B + one-off + extra batches), one line per
 *              product: name, amount, raw weight per piece from the production
 *              product (empty when not set), comment = where it comes from
 *              (B2C / B2B client / extra / other), several joined on one line.
 *   Orders   — one row per product line of every shop order for the pickup
 *              day(s), all statuses except cancelled/refunded (unchanged).
 * The template (templates/production-plan.xlsx) only lends its formatting:
 * Overview rows copy the style of its row 3, every other tab is removed.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = ['Bestellnummer', 'Bestelldatum', 'Abholtag', 'Typ', 'Name', 'Produkt', 'Menge', 'Einzelpreis_Cent', 'Gesamtpreis_Bestellung_Cent', 'Rabattcode', 'Rabatt_Cent', 'Zahlungsart', 'Status', 'Zahlung', 'Abholort'];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;

  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Bitte einen Abholtag wählen (YYYY-MM-DD).' }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: orders, error } = await supabase
    .from('orders')
    .select('order_number, created_at, fulfillment_date, order_type, customer_name, customer_email, total_cents, discount_code, discount_cents, payment_method, status, payment_status, pickup_locations(name), order_items(quantity, unit_price_cents, products(name))')
    .not('status', 'in', '("cancelled","refunded")')
    .gte('fulfillment_date', from)
    .lte('fulfillment_date', to)
    .order('fulfillment_date', { ascending: true })
    .order('order_number', { ascending: true })
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Overview from the bake sheets (at most 7 days) ──
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 7; d = addDays(d, 1)) days.push(d);
  type Line = { name: string; qty: number; weight: number | null; comments: Set<string>; pieces: number | null };
  const lines = new Map<string, Line>();
  const label = (s: ProductQty['by_source'][number]) =>
    s.source === 'web' ? 'B2C' : s.source === 'b2b' ? `B2B ${s.reason ?? ''}`.trim() : s.source === 'extra' ? `extra${s.reason ? ` (${s.reason})` : ''}` : (s.reason ?? 'other');
  for (const day of days) {
    const { sheet, data } = await getBakeSheet(supabase, day);
    const prod = new Map(data.products.map((p) => [p.id, p]));
    for (const row of sheet.products) {
      const p = prod.get(row.pr_product_id);
      const l = lines.get(row.pr_product_id) ?? { name: row.name, qty: 0, weight: null, comments: new Set<string>(), pieces: null };
      l.qty += row.qty;
      if (p && p.dough_per_unit_g > 0) { l.pieces = p.pieces_per_unit && p.pieces_per_unit > 1 ? p.pieces_per_unit : null; l.weight = p.dough_per_unit_g / (l.pieces ?? 1); }
      for (const s of row.by_source) if (s.qty > 0) l.comments.add(label(s));
      lines.set(row.pr_product_id, l);
    }
    // products without a recipe are not on the sheet's recipe blocks but still have to be baked
    for (const w of sheet.warnings) {
      if (w.type !== 'missing_recipe' || !w.pr_product_id || !w.qty) continue;
      const l = lines.get(w.pr_product_id) ?? { name: w.product_name ?? '?', qty: 0, weight: null, comments: new Set<string>(), pieces: null };
      l.qty += w.qty; l.comments.add('no recipe');
      lines.set(w.pr_product_id, l);
    }
  }
  const overview = [...lines.values()].filter((l) => l.qty > 0).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), 'templates', 'production-plan.xlsx'));
  const ws = wb.getWorksheet('Orders');
  const ov = wb.getWorksheet('Overview');
  if (!ws || !ov) return NextResponse.json({ error: 'Vorlage hat kein Blatt "Orders"/"Overview".' }, { status: 500 });
  for (const sheet of [...wb.worksheets]) if (sheet.name !== 'Orders' && sheet.name !== 'Overview') wb.removeWorksheet(sheet.id);

  // Overview: header stays (row 2), data rows copy the template's row-3 style, the old rows go.
  const styleOf = (addr: string) => { const c = ov.getCell(addr); return { font: c.font, fill: c.fill, border: c.border, alignment: c.alignment, numFmt: c.numFmt }; };
  const rowStyle = ['B3', 'C3', 'D3', 'E3'].map(styleOf);
  const sumStyle = styleOf('C22');
  const oldOv = ov.rowCount;
  for (let r = 3; r <= Math.max(oldOv, 3); r++) { const row = ov.getRow(r); row.values = []; for (const col of ['B', 'C', 'D', 'E']) { const c = ov.getCell(`${col}${r}`); c.style = {}; } }
  overview.forEach((l, i) => {
    const r = 3 + i;
    const rank = (c: string) => (c === 'B2C' ? 0 : c.startsWith('B2B') ? 1 : c.startsWith('extra') ? 2 : 3);
    const comments = [...l.comments].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y)).concat(l.pieces ? [`${l.pieces} pcs per unit`] : []);
    const vals: (string | number | null)[] = [l.name, l.qty, l.weight !== null ? Math.round(l.weight) : null, comments.join(', ')];
    ['B', 'C', 'D', 'E'].forEach((col, j) => { const c = ov.getCell(`${col}${r}`); c.value = vals[j]; c.style = { ...rowStyle[j] }; });
  });
  if (overview.length) {
    const sumRow = 3 + overview.length + 1;
    const c = ov.getCell(`C${sumRow}`); c.value = { formula: `SUM(C3:C${2 + overview.length})`, result: overview.reduce((n, l) => n + l.qty, 0) }; c.style = { ...sumStyle };
  }
  ov.getCell('B1').value = days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}`;
  ov.getCell('B1').font = { bold: true, size: 12, name: 'Aptos Narrow' };

  // Overwrite from row 1: the template's Orders tab carries empty formatted
  // rows, and spliceRows/addRow would append BELOW them (header on row 39).
  const rows: (string | number)[][] = [];
  let latest = from;
  for (const o of orders ?? []) {
    if (o.fulfillment_date && o.fulfillment_date > latest) latest = o.fulfillment_date;
    const items = (o.order_items || []) as { quantity: number; unit_price_cents: number; products?: { name?: string } | null }[];
    for (const it of items) {
      rows.push([
        o.order_number || '',
        (o.created_at || '').slice(0, 10),
        o.fulfillment_date || '',
        o.order_type === 'subscription' ? 'Abo' : 'Einmalig',
        o.customer_name || o.customer_email || '',
        it.products?.name || 'Unbekannt',
        it.quantity,
        it.unit_price_cents,
        o.total_cents,
        o.discount_code || '',
        o.discount_cents || 0,
        paymentMethodLabel(o.payment_method),
        orderStatusAdminLabels[o.status] || o.status,
        o.payment_status || '',
        (o.pickup_locations as { name?: string } | null)?.name || '',
      ]);
    }
  }
  const oldCount = ws.rowCount;
  ws.getRow(1).values = HEADERS;
  ws.getRow(1).font = { bold: true };
  rows.forEach((r, i) => { ws.getRow(i + 2).values = r; });
  for (let r = rows.length + 2; r <= oldCount; r++) ws.getRow(r).values = [];
  wb.calcProperties.fullCalcOnLoad = true;

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${latest}_production-plan.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
