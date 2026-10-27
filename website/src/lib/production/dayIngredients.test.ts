import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIngredientTotals, fmtAmount } from './dayIngredients.ts';
import type { BakeSheet, GramLine, RecipeBlock, StarterNeed, SubBlock } from './types';

const line = (id: string, name: string, grams: number, extra: Partial<GramLine> = {}): GramLine =>
  ({ item_id: id, label: name, ingredient_id: id, ingredient_name: name, unit: 'g', pct: null, grams, ...extra });

const starter = (flourId: string, flourName: string, flour: number, water: number, seed: number): StarterNeed =>
  ({ starter_id: 's', starter_name: 'Rye starter', item_id: 'st', label: 'Starter', in_dough_g: flour + water + seed, final_build_g: flour + water + seed,
    flour_ingredient_id: flourId, flour_ingredient_name: flourName, flour_g: flour, water_g: water, seed_g: seed });

const block = (over: Partial<RecipeBlock>): RecipeBlock => ({
  recipe_id: 'r', name: 'R', version: 1, products: [], total_dough_g: 0, sum_pct: 0, dough_margin_factor: 0, margin_g_per_batch: 0,
  batches: 1, max_batch_g: null, per_batch_dough_g: 0, factor: 1, batch_total_g: 0, lines: [], subs: [], starters: [],
  per_batch_items: [], extras: [], eggs_per_batch: 0, adjustments_applied: 0, ...over,
});

const sheet = (recipes: RecipeBlock[]): BakeSheet => ({ date: '2026-10-28', warnings: [], products: [], stock_products: [], recipes, starters: [], totals: { eggs: 0 }, versions: {} });

test('sums lines across recipes and multiplies by batches', () => {
  const t = dayIngredientTotals(sheet([
    block({ lines: [line('flour', 'Wheat flour T55/550', 3000), line('water', 'Water', 2000)], batches: 2 }),
    block({ lines: [line('flour', 'Wheat flour T55/550', 500), line('salt', 'Salt', 20)] }),
  ]));
  assert.deepEqual(t.map((x) => [x.name, x.amount]), [['Wheat flour T55/550', 6500], ['Water', 4000], ['Salt', 20]]);
});

test('pre-dough lines count (× batches), nested too', () => {
  const inner: SubBlock = { recipe_id: 'i', name: 'inner', version: 1, item_id: null, pct: 0, needed_g: 0, build_margin_pct: 0, total_g: 0, sum_pct: 0, factor: 1,
    lines: [line('honey', 'Honey', 10)], subs: [], starters: [] };
  const poolish: SubBlock = { ...inner, recipe_id: 'p', name: 'poolish', lines: [line('flour', 'Wheat flour T55/550', 400)], subs: [inner] };
  const t = dayIngredientTotals(sheet([block({ lines: [line('flour', 'Wheat flour T55/550', 100)], subs: [poolish], batches: 3 })]));
  assert.deepEqual(t.map((x) => [x.name, x.amount]), [['Wheat flour T55/550', 1500], ['Honey', 30]]);
});

test('starter: only flour and water of the final build, never the seed or the feeding stages', () => {
  const t = dayIngredientTotals(sheet([block({
    lines: [line('rye', 'Rye flour T130/1150', 1000), line('water', 'Water', 700)],
    starters: [starter('rye', 'Rye flour T130/1150', 200, 200, 40)],
  })]));
  assert.deepEqual(t.map((x) => [x.name, x.amount]), [['Rye flour T130/1150', 1200], ['Water', 900]]);
});

test('derived ingredients become whole eggs in pcs; extras and per-batch items are included', () => {
  const t = dayIngredientTotals(sheet([block({
    lines: [line('yolk', 'Egg yolk', 85, { source_units: 5, source_units_rounded: 5, source_name: 'Egg' }), line('sugar', 'Sugar', 100)],
    per_batch_items: [{ ingredient_id: 'yeast', ingredient_name: 'Yeast', unit: 'g', amount: 7 }],
    extras: [{ pr_product_id: 'x', product_name: 'Brioche', qty: 4, lines: [{ ingredient_id: 'pearl', ingredient_name: 'Pearl sugar', unit: 'g', per_piece: 5, total: 20 }] }],
    batches: 2,
  })]));
  assert.deepEqual(t.map((x) => [x.name, x.unit, x.amount]), [['Sugar', 'g', 200], ['Pearl sugar', 'g', 20], ['Yeast', 'g', 14], ['Egg', 'pcs', 10]]);
});

test('whole-egg lines and eggs behind a yolk line share one row', () => {
  const t = dayIngredientTotals(sheet([
    block({ lines: [{ item_id: 'e', label: 'Egg', ingredient_id: 'egg', ingredient_name: 'Egg', unit: 'pcs', pct: null, grams: 6 }] }),
    block({ lines: [line('yolk', 'Egg yolk', 51, { source_units: 3, source_units_rounded: 3, source_name: 'Egg' })] }),
  ]));
  assert.deepEqual(t.map((x) => [x.name, x.unit, x.amount]), [['Egg', 'pcs', 9]]);
});

test('fmtAmount', () => {
  assert.equal(fmtAmount({ unit: 'g', amount: 5500 }), '5.5 kg');
  assert.equal(fmtAmount({ unit: 'g', amount: 12345 }), '12.3 kg');
  assert.equal(fmtAmount({ unit: 'g', amount: 36.4 }), '36 g');
  assert.equal(fmtAmount({ unit: 'pcs', amount: 12 }), '12 pcs');
});
