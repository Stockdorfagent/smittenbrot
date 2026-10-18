/**
 * Print the live bake sheet for a date from the terminal (never stores a snapshot).
 *
 *   node --experimental-strip-types scripts/production-bake-sheet.ts 2026-10-14
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getBakeSheet, loadFreezer } from '../src/lib/production/data.ts';
import { g } from '../src/lib/production/engine.ts';
import type { SubBlock } from '../src/lib/production/types.ts';

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.error('usage: production-bake-sheet.ts YYYY-MM-DD'); process.exit(1); }
const root = join(process.cwd(), '..', '..');
const env = Object.fromEntries(readFileSync(join(root, '.credentials', 'aoryok.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { sheet, data, row } = await getBakeSheet(db, date, { forceLive: true });
console.log(`BAKE SHEET ${sheet.date}`);
for (const w of sheet.warnings) console.log('  WARNING:', w.text);
console.log('PRODUCTS');
for (const p of sheet.products) console.log(`  ${String(p.qty).padStart(3)} × ${p.name.padEnd(26)} ${p.dough_per_unit_g} g → ${g(p.dough_g)} g`);
for (const s of sheet.stock_products) console.log(`  ${String(s.qty).padStart(3)} × ${s.name.padEnd(26)} FROM FREEZER${s.pieces ? ` = ${s.pieces} pieces` : ''}${s.extras ? '  + ' + s.extras.lines.map((l) => `${l.ingredient_name} ${l.total} ${l.unit}`).join(', ') : ''}`);
const sub = (b: SubBlock, indent: string) => {
  console.log(`${indent}SUB ${b.name}: needed ${g(b.needed_g)} g + ${b.build_margin_pct} % = ${g(b.total_g)} g  (factor ${b.factor.toFixed(4)})`);
  for (const l of b.lines) console.log(`${indent}  ${l.label.padEnd(34)} ${String(l.pct).padStart(7)} %  ${String(g(l.grams)).padStart(6)} g`);
  for (const s of b.starters) console.log(`${indent}  ${s.label.padEnd(34)} in dough ${g(s.in_dough_g)} g → final build ${g(s.final_build_g)} g (${g(s.flour_g)} ${s.flour_ingredient_name} / ${g(s.water_g)} water / ${g(s.seed_g)} seed)`);
  for (const c of b.subs) sub(c, indent + '  ');
};
for (const r of sheet.recipes) {
  console.log(`RECIPE ${r.name} (v${r.version}): dough ${g(r.total_dough_g)} g, Σpct ${r.sum_pct}, margin ${r.dough_margin_factor} (+${g(r.margin_g_per_batch)} g/batch), batches ${r.batches}, factor ${r.factor.toFixed(4)}, batch total ${g(r.batch_total_g)} g`);
  for (const l of r.lines) console.log(`  ${l.label.padEnd(34)} ${String(l.pct).padStart(7)} %  ${String(g(l.grams)).padStart(6)} g${l.source_units_rounded ? `  = ${l.source_units_rounded} ${l.source_name}${l.byproduct ? ` → ${g(l.byproduct.grams)} g ${l.byproduct.ingredient_name}` : ''}` : ''}`);
  for (const s of r.starters) console.log(`  ${s.label.padEnd(34)} in dough ${g(s.in_dough_g)} g → final build ${g(s.final_build_g)} g (${g(s.flour_g)} ${s.flour_ingredient_name} / ${g(s.water_g)} water / ${g(s.seed_g)} seed)`);
  for (const b of r.subs) sub(b, '  ');
  for (const p of r.per_batch_items) console.log(`  per batch: ${p.amount} ${p.unit} ${p.ingredient_name}`);
  for (const e of r.extras) console.log(`  extras ${e.product_name} ×${e.qty}: ${e.lines.map((l) => `${l.ingredient_name} ${Math.round(l.total * 10) / 10} ${l.unit}`).join(', ')}`);
  if (r.eggs_per_batch) console.log(`  eggs per batch: ${r.eggs_per_batch}`);
}
console.log('STARTERS');
for (const s of sheet.starters) {
  console.log(`  ${s.name}`);
  for (const st of s.stages) {
    console.log(`    stage ${st.stage_no} (${st.date}): total ${g(st.total_g)} = ${g(st.flour_g)} ${st.flour_ingredient_name} / ${g(st.water_g)} water / ${g(st.seed_g)} seed`);
    for (const r of st.per_recipe ?? []) console.log(`        ${r.recipe_name.padEnd(24)} ${g(r.total_g)} = ${g(r.flour_g)} ${r.flour_ingredient_name} / ${g(r.water_g)} / ${g(r.seed_g)}`);
  }
  console.log(`    seed from kept starter: ${g(s.seed_from_kept_g)} g`);
}
console.log(`TOTAL EGGS ${sheet.totals.eggs}`);
console.log('FREEZER');
for (const f of await loadFreezer(db, date, data, row.extra_quantities)) console.log(`  ${f.name.padEnd(24)} stock ${f.counter}  out today ${f.usage_today}  made today ${f.batch_today}  then ${f.after_today}  ahead ${f.ahead.map((a) => `${a.date}:-${a.pieces}`).join(' ') || '-'}  projected ${f.projected} (min ${f.settings.min_level})  → make ${f.suggestion}`);
