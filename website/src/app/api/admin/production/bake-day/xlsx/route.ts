import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { withAdmin, bad } from '@/lib/production/api';
import { getBakeSheet } from '@/lib/production/data';
import { isValidISODate } from '@/lib/production/bakeDays';
import type { SubBlock } from '@/lib/production/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/production/bake-day/xlsx?date=YYYY-MM-DD → the bake sheet as a workbook
 * (one sheet per recipe + Products + Starters). The owner's existing Excel export
 * (/api/admin/production-plan) is untouched.
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!isValidISODate(date)) return bad('date must be YYYY-MM-DD.');
  return withAdmin(req, async (db) => {
    const { sheet } = await getBakeSheet(db, date);
    const wb = new ExcelJS.Workbook();
    const r1 = (n: number) => Math.round(n * 10) / 10;

    const products = wb.addWorksheet('Products');
    products.addRow(['Bake day', date]).font = { bold: true };
    products.addRow([]);
    products.addRow(['Product', 'Qty', 'Source', 'Dough per unit (g)', 'Dough (g)']).font = { bold: true };
    for (const p of sheet.products) products.addRow([p.name, p.qty, p.by_source.map((s) => `${s.source} ${s.qty}${s.reason ? ` (${s.reason})` : ''}`).join(', '), p.dough_per_unit_g, r1(p.dough_g)]);
    for (const s of sheet.stock_products) products.addRow([s.name, s.qty, 'from freezer', '', s.pieces ? `${s.pieces} pieces` : '']);
    if (sheet.warnings.length) {
      products.addRow([]);
      products.addRow(['Warnings']).font = { bold: true };
      for (const w of sheet.warnings) products.addRow([w.text]);
    }

    const writeSub = (ws: ExcelJS.Worksheet, b: SubBlock, depth: number) => {
      const ind = '  '.repeat(depth);
      ws.addRow([`${ind}${b.name}`, `needed ${r1(b.needed_g)} g + ${b.build_margin_pct} %`, r1(b.total_g)]).font = { bold: true };
      for (const l of b.lines) ws.addRow([`${ind}  ${l.label}`, l.pct, r1(l.grams)]);
      for (const s of b.starters) ws.addRow([`${ind}  ${s.label}`, null, r1(s.in_dough_g), `final build ${r1(s.final_build_g)} g: ${r1(s.flour_g)} ${s.flour_ingredient_name} / ${r1(s.water_g)} water / ${r1(s.seed_g)} seed`]);
      for (const c of b.subs) writeSub(ws, c, depth + 1);
    };
    for (const r of sheet.recipes) {
      const ws = wb.addWorksheet(r.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
      ws.addRow([r.name, `v${r.version}`]).font = { bold: true, size: 14 };
      ws.addRow(['Products', r.products.map((p) => `${p.qty}× ${p.name}`).join(', ')]);
      ws.addRow(['Total dough (g)', r1(r.total_dough_g), 'Σpct', r.sum_pct]);
      ws.addRow(['Dough margin factor', r.dough_margin_factor, 'margin per batch (g)', r1(r.margin_g_per_batch)]);
      ws.addRow(['Batches', r.batches, 'per batch (g)', r1(r.per_batch_dough_g), 'factor', r.factor]);
      ws.addRow([]);
      ws.addRow(['Ingredient (per batch)', '%', 'g', 'Note']).font = { bold: true };
      for (const l of r.lines) ws.addRow([l.label, l.pct, r1(l.grams), l.source_units_rounded ? `${l.source_units_rounded} ${l.source_name}${l.byproduct ? ` → ${r1(l.byproduct.grams)} g ${l.byproduct.ingredient_name}` : ''}` : (l.adjusted ? `adjusted from ${l.original_pct} %` : '')]);
      const direct = r.starters.filter((s) => r.subs.every((b) => !collect(b).some((x) => x.item_id === s.item_id)));
      for (const s of direct) ws.addRow([s.label, null, r1(s.in_dough_g), `final build ${r1(s.final_build_g)} g: ${r1(s.flour_g)} ${s.flour_ingredient_name} / ${r1(s.water_g)} water / ${r1(s.seed_g)} seed`]);
      ws.addRow(['Batch total (g)', null, r1(r.batch_total_g)]).font = { bold: true };
      if (r.subs.length) { ws.addRow([]); for (const b of r.subs) writeSub(ws, b, 0); }
      if (r.per_batch_items.length) { ws.addRow([]); for (const p of r.per_batch_items) ws.addRow([`per batch: ${p.ingredient_name}`, null, p.amount, p.unit]); }
      if (r.eggs_per_batch) ws.addRow(['Eggs per batch', null, r.eggs_per_batch]);
      for (const e of r.extras) {
        ws.addRow([]);
        ws.addRow([`Extras ${e.product_name} ×${e.qty}`, 'per piece (g)', 'total (g)']).font = { bold: true };
        for (const l of e.lines) ws.addRow([l.ingredient_name, l.per_piece, r1(l.total)]);
      }
      ws.getColumn(1).width = 36; ws.getColumn(2).width = 12; ws.getColumn(3).width = 12; ws.getColumn(4).width = 60;
    }

    const st = wb.addWorksheet('Starters');
    st.addRow(['Starter', 'Stage', 'Date', 'Total (g)', 'Flour (g)', 'Flour', 'Water (g)', 'Seed (g)']).font = { bold: true };
    for (const s of sheet.starters) {
      for (const stage of s.stages) {
        st.addRow([s.name, stage.stage_no, stage.date, r1(stage.total_g), r1(stage.flour_g), stage.flour_ingredient_name, r1(stage.water_g), r1(stage.seed_g)]);
        for (const pr of stage.per_recipe ?? []) st.addRow(['', `  ${pr.recipe_name}`, '', r1(pr.total_g), r1(pr.flour_g), pr.flour_ingredient_name, r1(pr.water_g), r1(pr.seed_g)]);
      }
      st.addRow([s.name, 'seed from kept starter', '', r1(s.seed_from_kept_g)]);
    }
    st.getColumn(1).width = 14; st.getColumn(2).width = 26; st.getColumn(6).width = 24;

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${date}_bake-sheet.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}

function collect(b: SubBlock): { item_id: string }[] {
  return [...b.starters, ...b.subs.flatMap(collect)];
}
