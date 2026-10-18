/**
 * One-time CSV import of the production data (recipes, ingredients, starters,
 * product links) from ../../stock-tracking/*.csv into the pr_ tables.
 *
 *   node --experimental-strip-types scripts/production-import.ts            # dry run: plan + warnings
 *   node --experimental-strip-types scripts/production-import.ts --commit   # write (refuses if recipes exist)
 *   node --experimental-strip-types scripts/production-import.ts --commit --replace   # wipe pr_ data first
 *
 * Reads the service role from ../../.credentials/aoryok.env. The same planner
 * backs the admin import page; this script exists so the first import can be
 * run and verified from the terminal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { planImport } from '../src/lib/production/csvImport.ts';
import { commitImportPlan } from '../src/lib/production/data.ts';

const root = join(process.cwd(), '..', '..');
const dir = process.env.STOCK_TRACKING_DIR || join(root, 'stock-tracking');
const env = Object.fromEntries(readFileSync(join(root, '.credentials', 'aoryok.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const files = {
  ingredients: readFileSync(join(dir, 'ingredients.csv'), 'utf8'),
  recipes: readFileSync(join(dir, 'recipes.csv'), 'utf8'),
  products: readFileSync(join(dir, 'products.csv'), 'utf8'),
  recipe_lines: readFileSync(join(dir, 'recipe_lines.csv'), 'utf8'),
};

const { data: shop, error } = await db.from('products').select('id, name, unit_label, active');
if (error) { console.error(error.message); process.exit(1); }
const plan = planImport(files, shop ?? []);
console.log(`ingredients ${plan.ingredients.length}, starters ${plan.starters.length}, recipes ${plan.recipes.length}, products ${plan.products.length}`);
for (const p of plan.products) console.log(`  product ${p.name.padEnd(28)} ${p.channel.padEnd(6)} ${p.link_status.padEnd(8)} ${p.production.padEnd(6)} recipe=${p.recipe}${p.pieces_per_unit ? ` pieces/unit=${p.pieces_per_unit}` : ''}`);
for (const w of plan.warnings) console.log('WARN', w);
for (const e of plan.errors) console.log('ERROR', e);
if (plan.errors.length) process.exit(1);

if (process.argv.includes('--commit')) {
  const result = await commitImportPlan(db, plan, { replace: process.argv.includes('--replace') });
  console.log('COMMITTED', result);
} else {
  console.log('dry run — add --commit to write');
}
