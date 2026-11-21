/**
 * The "Backplan": ONE Excel file per bake day, made the evening before (owner,
 * 21.11.2026). It joins what used to be three places — the owner's Produktionsplan
 * (Overview + Orders, from templates/production-plan.xlsx), the bake sheet export
 * (one tab per recipe + Starters) and the distribution (who gets what) — and
 * leaves empty Time / Notes columns everywhere, because the owner adds her own
 * steps, times and remarks in Excel.
 *
 * Tabs, in working order:
 *   Overview      what is baked (template style), products in shop order
 *   Prep          the evening before: starter stages, pre-doughs, ingredients to weigh
 *   <recipe> …    one per recipe: dough table per batch, pre-doughs, extras
 *   Starters      the feeding schedule, all stages with dates
 *   Orders        one row per product line of every shop order (unchanged format)
 *   Distribution  per pickup location → customer → items; B2B per client; freezer; one-offs
 *
 * The range export on /admin/exports (/api/admin/production-plan) is untouched.
 */
import ExcelJS from 'exceljs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBakeSheet } from './data';
import { dayIngredientTotals, fmtAmount } from './dayIngredients';
import { formatDateEN } from './bakeDays';
import { paymentMethodLabel, orderStatusAdminLabels } from '../adminLabels';
import type { ProductQty, SubBlock } from './types';
import { formatMinutes } from './recipeSteps';

const ORDER_HEADERS = ['Bestellnummer', 'Bestelldatum', 'Abholtag', 'Typ', 'Name', 'Produkt', 'Menge', 'Einzelpreis_Cent', 'Gesamtpreis_Bestellung_Cent', 'Rabattcode', 'Rabatt_Cent', 'Zahlungsart', 'Status', 'Zahlung', 'Abholort'];

interface OrderRow {
  order_number: string | null; created_at: string | null; fulfillment_date: string | null; order_type: string | null;
  customer_name: string | null; customer_email: string | null; total_cents: number; discount_code: string | null; discount_cents: number | null;
  payment_method: string | null; status: string; payment_status: string | null;
  pickup_locations: { name?: string } | null;
  order_items: { quantity: number; unit_price_cents: number; products?: { name?: string } | null }[] | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const safeName = (n: string) => n.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Tab';
const bold = (row: ExcelJS.Row, size?: number) => { row.font = { bold: true, ...(size ? { size } : {}) }; return row; };

function collectStarters(b: SubBlock): { item_id: string }[] {
  return [...b.starters, ...b.subs.flatMap(collectStarters)];
}

export async function buildBackplan(db: SupabaseClient, date: string): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const [{ sheet, data, b2b }, ordersRes] = await Promise.all([
    getBakeSheet(db, date),
    db.from('orders')
      .select('order_number, created_at, fulfillment_date, order_type, customer_name, customer_email, total_cents, discount_code, discount_cents, payment_method, status, payment_status, pickup_locations(name), order_items(quantity, unit_price_cents, products(name))')
      .not('status', 'in', '("cancelled","refunded")')
      .eq('fulfillment_date', date)
      .order('order_number', { ascending: true })
      .limit(10000),
  ]);
  if (ordersRes.error) throw new Error(ordersRes.error.message);
  const orders = (ordersRes.data ?? []) as unknown as OrderRow[];
  const prod = new Map(data.products.map((p) => [p.id, p]));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), 'templates', 'production-plan.xlsx'));
  const ordersWs = wb.getWorksheet('Orders');
  const ov = wb.getWorksheet('Overview');
  if (!ordersWs || !ov) throw new Error('Vorlage hat kein Blatt "Orders"/"Overview".');
  for (const s of [...wb.worksheets]) if (s.name !== 'Orders' && s.name !== 'Overview') wb.removeWorksheet(s.id);

  // ── Overview (template style; rows in the sheet's = the shop's order) ──
  const label = (s: ProductQty['by_source'][number]) =>
    s.source === 'web' ? 'B2C' : s.source === 'b2b' ? `B2B ${s.reason ?? ''}`.trim() : s.source === 'extra' ? `extra${s.reason ? ` (${s.reason})` : ''}` : (s.reason ?? 'other').replace(/^own\b/, 'own use').replace(/^test\b/, 'test bake');
  type Line = { name: string; qty: number; weight: number | null; comments: string[]; pieces: number | null };
  const overview: Line[] = [];
  for (const row of sheet.products) {
    if (!(row.qty > 0)) continue;
    const p = prod.get(row.pr_product_id);
    const pieces = p && p.pieces_per_unit && p.pieces_per_unit > 1 ? p.pieces_per_unit : null;
    const comments: string[] = [];
    for (const s of row.by_source) if (s.qty > 0 && !comments.includes(label(s))) comments.push(label(s));
    if (p?.own_ingredients) comments.push("client's ingredients");
    if (pieces) comments.push(`${pieces} pcs per unit`);
    overview.push({ name: row.name, qty: row.qty, weight: p && p.dough_per_unit_g > 0 ? p.dough_per_unit_g / (pieces ?? 1) : null, comments, pieces });
  }
  for (const s of sheet.stock_products) overview.push({ name: s.name, qty: s.qty, weight: null, comments: ['from the freezer', ...(s.pieces ? [`${s.pieces} pieces`] : [])], pieces: null });
  for (const w of sheet.warnings) {
    if (w.type !== 'missing_recipe' && w.type !== 'missing_weight') continue;
    if (!w.qty) continue;
    overview.push({ name: w.product_name ?? '?', qty: w.qty, weight: null, comments: [w.type === 'missing_recipe' ? 'no recipe' : 'raw mass not set'], pieces: null });
  }
  const styleOf = (addr: string) => { const c = ov.getCell(addr); return { font: c.font, fill: c.fill, border: c.border, alignment: c.alignment, numFmt: c.numFmt }; };
  const rowStyle = ['B3', 'C3', 'D3', 'E3'].map(styleOf);
  const sumStyle = styleOf('C22');
  for (let r = 3; r <= Math.max(ov.rowCount, 3); r++) { const row = ov.getRow(r); row.values = []; for (const col of ['B', 'C', 'D', 'E']) ov.getCell(`${col}${r}`).style = {}; }
  overview.forEach((l, i) => {
    const r = 3 + i;
    const vals: (string | number | null)[] = [l.name, l.qty, l.weight !== null ? Math.round(l.weight) : null, l.comments.join(', ')];
    ['B', 'C', 'D', 'E'].forEach((col, j) => { const c = ov.getCell(`${col}${r}`); c.value = vals[j]; c.style = { ...rowStyle[j] }; });
  });
  if (overview.length) {
    const sumRow = 3 + overview.length + 1;
    const c = ov.getCell(`C${sumRow}`); c.value = { formula: `SUM(C3:C${2 + overview.length})`, result: overview.reduce((n, l) => n + l.qty, 0) }; c.style = { ...sumStyle };
  }
  ov.getCell('B1').value = `${date} (${formatDateEN(date)})`;
  ov.getCell('B1').font = { bold: true, size: 12, name: 'Aptos Narrow' };

  // ── Prep (the evening before) ──
  const prep = wb.addWorksheet('Prep');
  prep.columns = [{ width: 38 }, { width: 14 }, { width: 44 }, { width: 10 }, { width: 40 }];
  bold(prep.addRow([`Prep for ${formatDateEN(date)} — the evening before`]), 14);
  prep.addRow([]);
  bold(prep.addRow(['Starters', 'Amount (g)', 'Detail', 'Time', 'Notes']));
  if (sheet.starters.length === 0) prep.addRow(['— none needed —']);
  for (const s of sheet.starters) {
    for (const stage of s.stages) {
      prep.addRow([`${s.name} · stage ${stage.stage_no} · ${formatDateEN(stage.date)}`, r1(stage.total_g), `${r1(stage.flour_g)} g ${stage.flour_ingredient_name} + ${r1(stage.water_g)} g water + ${r1(stage.seed_g)} g seed`]);
      for (const pr of stage.per_recipe ?? []) prep.addRow([`    for ${pr.recipe_name}`, r1(pr.total_g), `${r1(pr.flour_g)} g ${pr.flour_ingredient_name} + ${r1(pr.water_g)} g water + ${r1(pr.seed_g)} g seed`]);
    }
    prep.addRow([`${s.name} · seed from the kept starter`, r1(s.seed_from_kept_g)]);
  }
  prep.addRow([]);
  bold(prep.addRow(['Pre-doughs (per batch)', 'Amount (g)', 'Detail', 'Time', 'Notes']));
  let anySub = false;
  const writePrepSub = (recipeName: string, b: SubBlock, depth: number) => {
    anySub = true;
    const ind = '    '.repeat(depth);
    prep.addRow([`${ind}${b.name} — for ${recipeName}`, r1(b.total_g), `needed ${r1(b.needed_g)} g + ${b.build_margin_pct} % margin`]);
    for (const l of b.lines) prep.addRow([`${ind}    ${l.label}`, r1(l.grams), l.source_units_rounded ? `${l.source_units_rounded} ${l.source_name}` : '']);
    for (const st of b.starters) prep.addRow([`${ind}    ${st.label}`, r1(st.in_dough_g), `final build ${r1(st.final_build_g)} g`]);
    for (const c of b.subs) writePrepSub(recipeName, c, depth + 1);
  };
  for (const r of sheet.recipes) for (const b of r.subs) writePrepSub(r.batches > 1 ? `${r.name} (×${r.batches} batches)` : r.name, b, 0);
  if (!anySub) prep.addRow(['— none —']);
  prep.addRow([]);
  bold(prep.addRow(['Ingredients to weigh (whole day)', 'Amount', 'Unit', 'Time', 'Notes']));
  for (const t of dayIngredientTotals(sheet)) prep.addRow([t.name, t.unit === 'pcs' ? Math.ceil(t.amount - 1e-9) : Math.round(t.amount), t.unit === 'pcs' ? 'pcs' : `g (${fmtAmount(t)})`]);
  prep.addRow([]);
  bold(prep.addRow(['Bake list', 'Qty', 'Source', 'Time', 'Notes']));
  for (const p of sheet.products) prep.addRow([p.name, p.qty, p.by_source.map((s) => `${label(s)} ${s.qty}`).join(', ') + (prod.get(p.pr_product_id)?.own_ingredients ? " · client's ingredients" : '')]);
  for (const s of sheet.stock_products) prep.addRow([s.name, s.qty, `from the freezer${s.pieces ? ` (${s.pieces} pieces)` : ''}`]);
  if (sheet.warnings.length) { prep.addRow([]); bold(prep.addRow(['Warnings'])); for (const w of sheet.warnings) prep.addRow([w.text]); }

  // ── one tab per recipe ──
  for (const r of sheet.recipes) {
    const ws = wb.addWorksheet(safeName(r.name));
    ws.columns = [{ width: 36 }, { width: 10 }, { width: 12 }, { width: 48 }, { width: 10 }, { width: 40 }];
    bold(ws.addRow([r.name, `v${r.version}`]), 14);
    ws.addRow(['Products', r.products.map((p) => `${p.qty}× ${p.name}`).join(', ')]);
    ws.addRow(['Total dough (g)', r1(r.total_dough_g), 'Σpct', Math.round(r.sum_pct * 100) / 100]);
    ws.addRow(['Dough margin factor', r.dough_margin_factor, 'margin per batch (g)', r1(r.margin_g_per_batch)]);
    ws.addRow(['Batches', r.batches, 'per batch (g)', r1(r.per_batch_dough_g)]);
    ws.addRow([]);
    bold(ws.addRow(['Ingredient (per batch)', '%', 'g', 'Note', 'Time', 'Notes']));
    for (const l of r.lines) ws.addRow([l.label, l.pct, r1(l.grams), l.source_units_rounded ? `${l.source_units_rounded} ${l.source_name}${l.byproduct ? ` → ${r1(l.byproduct.grams)} g ${l.byproduct.ingredient_name}` : ''}` : (l.adjusted ? `adjusted from ${l.original_pct} %` : '')]);
    const direct = r.starters.filter((s) => r.subs.every((b) => !collectStarters(b).some((x) => x.item_id === s.item_id)));
    for (const s of direct) ws.addRow([s.label, null, r1(s.in_dough_g), `final build ${r1(s.final_build_g)} g: ${r1(s.flour_g)} ${s.flour_ingredient_name} / ${r1(s.water_g)} water / ${r1(s.seed_g)} seed`]);
    for (const b of r.subs) ws.addRow([`${b.name} (pre-dough, see Prep)`, b.pct, r1(b.needed_g), `build ${r1(b.total_g)} g (+${b.build_margin_pct} %)`]);
    bold(ws.addRow(['Batch total (g)', null, r1(r.batch_total_g)]));
    const writeSub = (b: SubBlock, depth: number) => {
      const ind = '  '.repeat(depth);
      bold(ws.addRow([`${ind}${b.name}`, `needed ${r1(b.needed_g)} g + ${b.build_margin_pct} %`, r1(b.total_g)]));
      for (const l of b.lines) ws.addRow([`${ind}  ${l.label}`, l.pct, r1(l.grams)]);
      for (const s of b.starters) ws.addRow([`${ind}  ${s.label}`, null, r1(s.in_dough_g), `final build ${r1(s.final_build_g)} g: ${r1(s.flour_g)} ${s.flour_ingredient_name} / ${r1(s.water_g)} water / ${r1(s.seed_g)} seed`]);
      for (const c of b.subs) ws.addRow([`${ind}  ${c.name} (pre-dough, see below)`, c.pct, r1(c.needed_g), `build ${r1(c.total_g)} g (+${c.build_margin_pct} %)`]);
      for (const c of b.subs) writeSub(c, depth + 1);
    };
    if (r.subs.length) { ws.addRow([]); for (const b of r.subs) writeSub(b, 0); }
    if (r.per_batch_items.length) { ws.addRow([]); for (const p of r.per_batch_items) ws.addRow([`per batch: ${p.ingredient_name}`, null, p.amount, p.unit]); }
    if (r.eggs_per_batch) ws.addRow(['Eggs per batch', null, r.eggs_per_batch]);
    for (const e of r.extras) {
      ws.addRow([]);
      bold(ws.addRow([`Extras ${e.product_name} ×${e.qty}`, 'per piece', 'total', 'unit']));
      for (const l of e.lines) ws.addRow([l.ingredient_name, l.per_piece, l.unit === 'pcs' ? Math.ceil(l.total - 1e-9) : r1(l.total), l.unit === 'pcs' ? `pcs (${l.total} rounded up)` : 'g']);
    }
    const steps = data.recipes.find((x) => x.id === r.recipe_id)?.steps;
    ws.addRow([]);
    if (steps && steps.method.length) {
      bold(ws.addRow(['Method', 'Duration / value', '', 'Detail', 'Time', 'Notes']));
      for (const m of steps.method) ws.addRow([m.label, m.value, '', m.detail]);
    } else {
      bold(ws.addRow(['Steps (none saved yet — add them on the recipe page)', '', '', '', 'Time', 'Notes']));
      for (let i = 0; i < 12; i++) ws.addRow([`${i + 1}.`]);
    }
    if (steps && steps.planning.length) {
      ws.addRow([]);
      bold(ws.addRow(['Planning', 'Duration', 'Minutes', 'Free for other work?', 'Start', 'Notes']));
      for (const p of steps.planning) ws.addRow([p.task, p.duration, formatMinutes(p.min_minutes, p.max_minutes), p.hands_free ? 'yes' : 'no']);
    }
  }

  // ── Starters ──
  const st = wb.addWorksheet('Starters');
  st.columns = [{ width: 14 }, { width: 26 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 24 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 }];
  bold(st.addRow(['Starter', 'Stage', 'Date', 'Total (g)', 'Flour (g)', 'Flour', 'Water (g)', 'Seed (g)', 'Time', 'Notes']));
  for (const s of sheet.starters) {
    for (const stage of s.stages) {
      st.addRow([s.name, stage.stage_no, stage.date, r1(stage.total_g), r1(stage.flour_g), stage.flour_ingredient_name, r1(stage.water_g), r1(stage.seed_g)]);
      for (const pr of stage.per_recipe ?? []) st.addRow(['', `  ${pr.recipe_name}`, '', r1(pr.total_g), r1(pr.flour_g), pr.flour_ingredient_name, r1(pr.water_g), r1(pr.seed_g)]);
    }
    st.addRow([s.name, 'seed from kept starter', '', r1(s.seed_from_kept_g)]);
  }

  // ── Orders (template tab, unchanged format) ──
  const rows: (string | number)[][] = [];
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      rows.push([
        o.order_number || '', (o.created_at || '').slice(0, 10), o.fulfillment_date || '', o.order_type === 'subscription' ? 'Abo' : 'Einmalig',
        o.customer_name || o.customer_email || '', it.products?.name || 'Unbekannt', it.quantity, it.unit_price_cents, o.total_cents,
        o.discount_code || '', o.discount_cents || 0, paymentMethodLabel(o.payment_method), orderStatusAdminLabels[o.status] || o.status, o.payment_status || '',
        o.pickup_locations?.name || '',
      ]);
    }
  }
  const oldCount = ordersWs.rowCount;
  ordersWs.getRow(1).values = ORDER_HEADERS;
  ordersWs.getRow(1).font = { bold: true };
  rows.forEach((r, i) => { ordersWs.getRow(i + 2).values = r; });
  for (let r = rows.length + 2; r <= oldCount; r++) ordersWs.getRow(r).values = [];

  // ── Distribution ──
  const dist = wb.addWorksheet('Distribution');
  dist.columns = [{ width: 22 }, { width: 30 }, { width: 34 }, { width: 8 }, { width: 30 }, { width: 8 }];
  bold(dist.addRow([`Distribution ${formatDateEN(date)}`]), 14);
  // shop orders per pickup location → customer
  const byLoc = new Map<string, OrderRow[]>();
  for (const o of orders) { const k = o.pickup_locations?.name || 'Abholort unbekannt'; byLoc.set(k, [...(byLoc.get(k) ?? []), o]); }
  for (const [loc, list] of [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dist.addRow([]);
    bold(dist.addRow([loc, 'Customer', 'Product', 'Qty', 'Note', 'Done']));
    for (const o of list.sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''))) {
      const items = o.order_items ?? [];
      items.forEach((it, i) => dist.addRow(['', i === 0 ? (o.customer_name || o.customer_email || '') : '', it.products?.name || 'Unbekannt', it.quantity, i === 0 ? `${o.order_number || ''}${o.order_type === 'subscription' ? ' · Abo' : ''}${o.payment_status && o.payment_status !== 'paid' ? ` · ${o.payment_status}` : ''}` : '']));
    }
    dist.addRow(['', `${list.length} ${list.length === 1 ? 'order' : 'orders'}`, '', list.reduce((n, o) => n + (o.order_items ?? []).reduce((m, it) => m + it.quantity, 0), 0)]);
  }
  if (byLoc.size === 0) { dist.addRow([]); dist.addRow(['Shop orders', '— none —']); }
  // B2B per client
  const b2bRows: [string, string, number, string][] = [];
  for (const p of b2b.planned) {
    if (p.skipped) { b2bRows.push([p.client.name, '— skipped today —', 0, p.override?.note ?? '']); continue; }
    for (const it of p.items) b2bRows.push([p.client.name, prod.get(it.pr_product_id)?.name ?? 'unknown product', it.qty, [p.source === 'override' ? 'changed for today' : '', p.override?.note ?? '', prod.get(it.pr_product_id)?.own_ingredients ? "client's ingredients" : ''].filter(Boolean).join(' · ')]);
  }
  for (const m of b2b.manual) {
    const who = m.type === 'b2b' ? (b2b.clients.find((c) => c.id === m.client_id)?.name ?? m.label ?? 'B2B') : `${m.type === 'own' ? 'own use' : m.type === 'test' ? 'test bake' : m.type}${m.label ? ` "${m.label}"` : ''}`;
    for (const it of m.items) b2bRows.push([who, prod.get(it.pr_product_id)?.name ?? 'unknown product', it.qty, m.notes ?? '']);
  }
  dist.addRow([]);
  bold(dist.addRow(['B2B / one-offs', 'Client', 'Product', 'Qty', 'Note', 'Done']));
  if (b2bRows.length === 0) dist.addRow(['', '— none —']);
  for (const [who, name, qty, note] of b2bRows) dist.addRow(['', who, name, qty || '', note]);
  const clientNotes = b2b.clients.filter((c) => c.active && c.notes && b2bRows.some((r) => r[0] === c.name));
  for (const c of clientNotes) dist.addRow(['', `${c.name}:`, c.notes]);
  // freezer
  dist.addRow([]);
  bold(dist.addRow(['Freezer', 'Product', 'Out today', 'Qty', 'Note', 'Done']));
  if (sheet.stock_products.length === 0) dist.addRow(['', '— nothing from the freezer —']);
  for (const s of sheet.stock_products) dist.addRow(['', s.name, s.pieces ? `${s.pieces} pieces` : '', s.qty, s.pieces_per_unit ? `${s.pieces_per_unit} per bag` : '']);
  const intoFreezer = sheet.products.flatMap((p) => p.by_source.filter((s) => s.source === 'extra').map((s) => [p.name, s.qty, s.reason ?? ''] as const));
  if (intoFreezer.length) { bold(dist.addRow(['', 'Into the freezer'])); for (const [name, qty, reason] of intoFreezer) dist.addRow(['', name, '', qty, reason]); }

  // tab order = working order (the template puts Orders second)
  const order = ['Overview', 'Prep', ...sheet.recipes.map((r) => safeName(r.name)), 'Starters', 'Orders', 'Distribution'];
  for (const ws of wb.worksheets) { const i = order.indexOf(ws.name); (ws as ExcelJS.Worksheet & { orderNo: number }).orderNo = i >= 0 ? i + 1 : order.length + 1; }   // exceljs sorts tabs by orderNo (not in its typings)
  wb.calcProperties.fullCalcOnLoad = true;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: buffer as ArrayBuffer, filename: `${date}_backplan.xlsx` };
}
