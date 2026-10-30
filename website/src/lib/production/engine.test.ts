/**
 * Acceptance tests from SPEC-produktion-lager.md §1.6 plus the Rye & Wheat
 * chain the owner confirmed on 18.10.2026.
 *
 * Run: npm run test:production   (node --experimental-strip-types --test, no extra dependency)
 *
 * The spec's Brioche figures use margin 0.1 as a pure engine input; the
 * imported recipe carries 0.05 from recipes.csv (owner, 18.10.2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBakeSheet, previewForPieces, previewForBaseAmount, validateRecipe, g } from './engine.ts';
import type { Ingredient, ProductionData, Recipe, RecipeItem, Starter, ProductLink, Demand } from './types.ts';

// ---------- fixtures ----------

const ING: Record<string, Ingredient> = {};
function ing(name: string, unit: 'g' | 'pcs' = 'g', extra: Partial<Ingredient> = {}): Ingredient {
  const i: Ingredient = { id: `ing-${name}`, name, unit, name_de: null, allergens: [], components_de: null, derived_from: null, g_per_source_unit: null, notes: null, track_stock: true, track_bbf: false, reorder_level: null, made_from_recipe_id: null, ...extra };
  ING[name] = i;
  return i;
}
ing('Wheat flour T80/1050'); ing('Wheat flour T55/550'); ing('Spelt flour T65/630'); ing('Rye flour T170/Vollkorn'); ing('Rye flour T130/1150');
ing('Water'); ing('Salt'); ing('Acerola powder'); ing('Yeast'); ing('Vanilla'); ing('Lemon'); ing('Rum'); ing('Milk'); ing('Butter'); ing('Sugar'); ing('Honey');
ing('Egg', 'pcs');
ing('Egg yolk', 'g', { derived_from: 'ing-Egg', g_per_source_unit: 17 });
ing('Egg white', 'g', { derived_from: 'ing-Egg', g_per_source_unit: 33 });
ing('Almond flour'); ing('Almond extract'); ing('Powdered sugar');

const LL_WHEAT: Starter = {
  id: 'st-wheat', name: 'LL Wheat', maintenance_flour_ingredient_id: 'ing-Wheat flour T80/1050',
  stages: [
    { stage_no: 1, day_offset: -1, flour_parts: 2, water_parts: 1, seed_parts: 1, flour_from_recipe: true },
    { stage_no: 2, day_offset: -2, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
    { stage_no: 3, day_offset: -3, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
  ],
};
const LL_RYE: Starter = {
  id: 'st-rye', name: 'LL Rye', maintenance_flour_ingredient_id: 'ing-Rye flour T130/1150',
  stages: [
    { stage_no: 1, day_offset: -1, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
    { stage_no: 2, day_offset: -2, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
    { stage_no: 3, day_offset: -3, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
  ],
};

let pos = 0;
function line(recipe: string, type: RecipeItem['type'], item: string, pct: number, label: string | null = null, finalFlour: string | null = null): RecipeItem {
  pos++;
  return {
    id: `it-${recipe}-${pos}`, position: pos, type,
    ingredient_id: type === 'ingredient' ? `ing-${item}` : null,
    sub_recipe_id: type === 'sub' ? `rec-${item}` : null,
    starter_id: type === 'starter' ? (item === 'LL Wheat' ? 'st-wheat' : 'st-rye') : null,
    final_flour_ingredient_id: finalFlour ? `ing-${finalFlour}` : null,
    pct, label,
  };
}
function recipe(name: string, kind: 'dough' | 'sub', items: RecipeItem[], opts: Partial<Recipe> = {}): Recipe {
  return { id: `rec-${name}`, name, kind, base_ingredient_id: null, dough_margin_factor: null, build_margin_pct: null, max_batch_g: null, per_batch_items: [], current_version: 1, notes: null, items, ...opts };
}

pos = 0;
const STOCKDORF = recipe('Stockdorf', 'dough', [
  line('s', 'ingredient', 'Wheat flour T80/1050', 100),
  line('s', 'ingredient', 'Acerola powder', 0.05),
  line('s', 'ingredient', 'Salt', 2.3),
  line('s', 'starter', 'LL Wheat', 40, 'stiff levain', 'Wheat flour T80/1050'),
  line('s', 'ingredient', 'Water', 75),
  line('s', 'ingredient', 'Water', 2.5, 'bassinage'),
], { dough_margin_factor: 0.05, max_batch_g: 4500 });

pos = 0;
const BRIOCHE = recipe('Brioche', 'dough', [
  line('b', 'ingredient', 'Wheat flour T55/550', 95),
  line('b', 'ingredient', 'Spelt flour T65/630', 5),
  line('b', 'ingredient', 'Salt', 2),
  line('b', 'ingredient', 'Yeast', 3),
  line('b', 'ingredient', 'Vanilla', 0.5),
  line('b', 'ingredient', 'Lemon', 0.5),
  line('b', 'starter', 'LL Wheat', 6, 'stiff levain', 'Wheat flour T80/1050'),
  line('b', 'ingredient', 'Egg yolk', 13),
  line('b', 'ingredient', 'Rum', 1),
  line('b', 'ingredient', 'Milk', 43, 'cold'),
  line('b', 'ingredient', 'Butter', 21, 'cold'),
  line('b', 'ingredient', 'Sugar', 11),
], { dough_margin_factor: 0.1, max_batch_g: 3000, per_batch_items: [{ ingredient_id: 'ing-Egg', amount: 1 }] });

pos = 0;
const VOORDEEG = recipe('Rye & Wheat voordeeg', 'sub', [
  line('v', 'ingredient', 'Rye flour T170/Vollkorn', 50),
  line('v', 'ingredient', 'Rye flour T130/1150', 50),
  line('v', 'ingredient', 'Water', 100),
  line('v', 'ingredient', 'Salt', 1.89),
  line('v', 'starter', 'LL Rye', 20.08, 'liquide levain', 'Rye flour T130/1150'),
], { build_margin_pct: 3 });

pos = 0;
const RYE = recipe('Rye & Wheat', 'dough', [
  line('r', 'ingredient', 'Water', 44.59),
  line('r', 'ingredient', 'Rye flour T170/Vollkorn', 32.16),
  line('r', 'ingredient', 'Rye flour T130/1150', 32.16),
  line('r', 'ingredient', 'Wheat flour T55/550', 35.68),
  line('r', 'ingredient', 'Acerola powder', 0.1),
  line('r', 'ingredient', 'Salt', 2.16),
  line('r', 'ingredient', 'Honey', 5.41),
  line('r', 'sub', 'Rye & Wheat voordeeg', 158.38),
], { dough_margin_factor: 0.1, max_batch_g: 3000 });

pos = 0;
const AMARETTI = recipe('Amaretti Classici', 'dough', [
  line('a', 'ingredient', 'Egg white', 100),
  line('a', 'ingredient', 'Almond flour', 286),
  line('a', 'ingredient', 'Sugar', 257),
  line('a', 'ingredient', 'Almond extract', 7),
], { dough_margin_factor: 0 });

pos = 0;
const ONLY_WHEAT_STARTER = recipe('only wheat starter', 'dough', [line('ow', 'starter', 'LL Wheat', 100, null, 'Wheat flour T80/1050')], { dough_margin_factor: 0 });
pos = 0;
const ONLY_RYE_STARTER = recipe('only rye starter', 'dough', [line('or', 'starter', 'LL Rye', 100)], { dough_margin_factor: 0 });

function product(name: string, recipeId: string | null, dough: number, extra: Partial<ProductLink> = {}): ProductLink {
  return { id: `pp-${name}`, product_id: `shop-${name}`, name, channel: 'web', recipe_id: recipeId, dough_per_unit_g: dough, bake_loss_pct: null, extras: [], production: 'orders', pieces_per_unit: null, pieces_from_shop: false, b2b_net_price_cents: null, link_status: 'linked', ...extra };
}

const DATA: ProductionData = {
  ingredients: Object.values(ING),
  starters: [LL_WHEAT, LL_RYE],
  recipes: [STOCKDORF, BRIOCHE, VOORDEEG, RYE, AMARETTI, ONLY_WHEAT_STARTER, ONLY_RYE_STARTER],
  products: [
    product('Stockdorf Sourdough', 'rec-Stockdorf', 850),
    product('Brioche', 'rec-Brioche', 265, { extras: [{ ingredient_id: 'ing-Egg', grams: 1 }] }),
    product('Rye & Wheat', 'rec-Rye & Wheat', 850),
    product('Amaretti Classici', 'rec-Amaretti Classici', 50, { production: 'stock', pieces_per_unit: 5, extras: [{ ingredient_id: 'ing-Sugar', grams: 0.5 }, { ingredient_id: 'ing-Powdered sugar', grams: 0.5 }] }),
  ],
  settings: { dough_margin_factor: 0.1, build_margin_pct: 10, final_build_margin_pct: 10 },
};

function demand(name: string, qty: number, source: Demand['source'] = 'web'): Demand {
  return { pr_product_id: `pp-${name}`, product_name: name, qty, source };
}
function lineG(block: { lines: { ingredient_name: string; label: string; grams: number }[] }, label: string) {
  const l = block.lines.find((x) => x.label === label || x.ingredient_name === label);
  assert.ok(l, `line ${label} missing`);
  return l.grams;
}
function close(actual: number, expected: number, tol = 0.051, what = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${what} expected ${expected}, got ${actual}`);
}

// ---------- §1.6 Stockdorf ----------

test('Stockdorf 2 pcs: flour 778, water 584, stiff levain 311, total 1711, last refresh 342 (171/86/86)', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Stockdorf Sourdough', 2)], DATA);
  const b = sheet.recipes[0];
  assert.equal(b.sum_pct, 219.85);
  assert.equal(b.batches, 1);
  assert.equal(g(lineG(b, 'Wheat flour T80/1050')), 778);
  assert.equal(g(lineG(b, 'Water')), 584);
  assert.equal(g(b.starters[0].in_dough_g), 311);
  assert.equal(g(b.batch_total_g), 1711);
  const lr = b.starters[0];
  assert.equal(g(lr.final_build_g), 342);
  assert.equal(g(lr.flour_g), 171);
  assert.equal(g(lr.water_g), 86);
  assert.equal(g(lr.seed_g), 86);
  assert.equal(lr.flour_ingredient_name, 'Wheat flour T80/1050');
  assert.equal(sheet.warnings.length, 0);
});

test('Stockdorf 5 pcs: flour 1938, total 4261, last refresh 853', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Stockdorf Sourdough', 5)], DATA);
  const b = sheet.recipes[0];
  assert.equal(g(lineG(b, 'Wheat flour T80/1050')), 1938);
  assert.equal(g(b.batch_total_g), 4261);
  assert.equal(g(b.starters[0].final_build_g), 853);
  assert.equal(b.batches, 1); // 4250 g ≤ 4500 g
});

// ---------- §1.6 Brioche (engine margin 0.1) ----------

test('Brioche 1 pc, margin 0.1: factor 1.418, T550 135, milk 61, butter 30, total 285; eggs', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Brioche', 1)], DATA);
  const b = sheet.recipes[0];
  close(b.factor, 265 / 201 + 0.1, 1e-9, 'factor');
  assert.equal(g(lineG(b, 'Wheat flour T55/550')), 135);
  assert.equal(g(lineG(b, 'Milk (cold)')), 61);
  assert.equal(g(lineG(b, 'Butter (cold)')), 30);
  assert.equal(g(b.batch_total_g), 285);
  const yolk = b.lines.find((l) => l.ingredient_name === 'Egg yolk')!;
  close(yolk.grams, 13 * b.factor, 1e-9);
  assert.equal(yolk.source_units_rounded, 2);           // 18.4 g / 17 → 2 eggs
  assert.equal(yolk.byproduct?.ingredient_name, 'Egg white');
  assert.equal(yolk.byproduct?.grams, 66);              // 2 × 33 g
  assert.equal(b.per_batch_items[0].amount, 1);          // egg wash
  assert.equal(b.eggs_per_batch, 3);
  assert.equal(sheet.totals.eggs, 3);
  // brioche extras (Egg=1 g per piece) are listed, never costed/stocked
  assert.equal(b.extras[0].lines[0].total, 1);
});

// ---------- §1.6 starter chains (margin 0) ----------

test('Starter chain LL Wheat: 980 → 490/245/245 → 98/98/49 → 19.6/19.6/9.8', () => {
  const data = { ...DATA, settings: { ...DATA.settings, final_build_margin_pct: 0 } };
  const { starters } = previewForPieces(ONLY_WHEAT_STARTER, 1, 980, data);
  const s = starters[0].stages;
  close(s[0].total_g, 980, 1e-9); close(s[0].flour_g, 490, 1e-9); close(s[0].water_g, 245, 1e-9); close(s[0].seed_g, 245, 1e-9);
  close(s[1].total_g, 245, 1e-9); close(s[1].flour_g, 98, 1e-9); close(s[1].water_g, 98, 1e-9); close(s[1].seed_g, 49, 1e-9);
  close(s[2].total_g, 49, 1e-9); close(s[2].flour_g, 19.6, 1e-9); close(s[2].water_g, 19.6, 1e-9); close(s[2].seed_g, 9.8, 1e-9);
  close(starters[0].seed_from_kept_g, 9.8, 1e-9);
  assert.deepEqual(s.map((x) => x.day_offset), [-1, -2, -3]);
});

test('Starter chain LL Rye: 135 → 54/54/27 → 10.8/10.8/5.4 → 2.16/2.16/1.08', () => {
  const data = { ...DATA, settings: { ...DATA.settings, final_build_margin_pct: 0 } };
  const { starters } = previewForPieces(ONLY_RYE_STARTER, 1, 135, data);
  const s = starters[0].stages;
  close(s[0].flour_g, 54, 1e-9); close(s[0].water_g, 54, 1e-9); close(s[0].seed_g, 27, 1e-9);
  close(s[1].flour_g, 10.8, 1e-9); close(s[1].water_g, 10.8, 1e-9); close(s[1].seed_g, 5.4, 1e-9);
  close(s[2].flour_g, 2.16, 1e-9); close(s[2].water_g, 2.16, 1e-9); close(s[2].seed_g, 1.08, 1e-9);
});

// ---------- Rye & Wheat chain (owner 18.10.2026): margins compound ----------

test('Rye & Wheat 3 × 850: factor 8.309, voordeeg 1316 → 1355 (+3 %), LL Rye 122.6 → 134.9 (+10 %)', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Rye & Wheat', 3)], DATA);
  const b = sheet.recipes[0];
  close(b.sum_pct, 310.64, 1e-9);
  close(b.factor, 2550 / 310.64 + 0.1, 1e-9);
  const vd = b.subs[0];
  close(vd.needed_g, 1316.0, 0.05); close(vd.build_margin_pct, 3, 0); close(vd.total_g, 1355.4, 0.05);
  close(vd.sum_pct, 221.97, 1e-9);
  const ll = b.starters[0];
  assert.equal(ll.starter_name, 'LL Rye');
  close(ll.in_dough_g, 122.6, 0.05);
  close(ll.final_build_g, 134.9, 0.05);
  assert.equal(ll.flour_ingredient_name, 'Rye flour T130/1150');
  // feeding schedule for the day before: 2:2:1
  const st = sheet.starters.find((s) => s.name === 'LL Rye')!;
  close(st.stages[0].flour_g, 134.9 * 2 / 5, 0.05);
  assert.equal(st.stages[0].date, '2026-10-13');
  assert.equal(st.stages[2].date, '2026-10-11');
});

test('Rye & Wheat 4 × 850 = 3400 g > 3000 g: 2 batches of 1700 g, margin per batch, warning', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Rye & Wheat', 4)], DATA);
  const b = sheet.recipes[0];
  assert.equal(b.batches, 2);
  close(b.per_batch_dough_g, 1700, 1e-9);
  close(b.factor, 1700 / 310.64 + 0.1, 1e-9);
  assert.ok(sheet.warnings.some((w) => w.type === 'batch_split' && w.text.includes('2 batches')));
  // the starter schedule covers both batches
  const st = sheet.starters.find((s) => s.name === 'LL Rye')!;
  close(st.stages[0].total_g, b.starters[0].final_build_g * 2, 1e-9);
});

// ---------- bake sheet behaviour ----------

test('Orders without a linked recipe are a loud warning, never dropped', () => {
  const sheet = computeBakeSheet('2026-10-14', [
    { pr_product_id: null, product_name: 'Amaretti Cacao & Caffè', qty: 4, source: 'web' },
    demand('Stockdorf Sourdough', 5),
  ], DATA);
  assert.equal(sheet.warnings.length, 1);
  assert.equal(sheet.warnings[0].text, '4× Amaretti Cacao & Caffè – no recipe linked');
  assert.equal(sheet.recipes.length, 1);
});

test('Stock products: pieces from the freezer plus coating, no dough from orders', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Amaretti Classici', 3)], DATA);
  assert.equal(sheet.recipes.length, 0);
  assert.equal(sheet.stock_products.length, 1);
  assert.equal(sheet.stock_products[0].pieces, 15);
  assert.equal(sheet.stock_products[0].extras?.lines[0].total, 1.5);
});

test('Stock product: web orders from the freezer, extra quantities INTO the freezer join the dough batch', () => {
  const data = { ...DATA, products: [...DATA.products, product('Baby-Brioche Lumbono', 'rec-Brioche', 50, { channel: 'intern', product_id: null, pieces_from_shop: false, b2b_net_price_cents: null, link_status: 'internal', production: 'stock' })] };
  const sheet = computeBakeSheet('2026-10-14', [demand('Brioche', 1), { ...demand('Baby-Brioche Lumbono', 6, 'extra'), reason: 'Freezer stock' }, { ...demand('Baby-Brioche Lumbono', 2, 'b2b'), reason: 'Lumbono' }, demand('Amaretti Classici', 2)], data);
  const b = sheet.recipes.find((r) => r.name === 'Brioche')!;
  close(b.total_dough_g, 265 + 6 * 50, 1e-9);
  assert.deepEqual(b.products.map((p) => [p.name, p.qty]), [['Baby-Brioche Lumbono', 6], ['Brioche', 1]]);
  // web and B2B orders of a stock product are delivered from the freezer, never baked from orders
  assert.deepEqual(sheet.stock_products.map((s) => [s.name, s.qty]), [['Amaretti Classici', 2], ['Baby-Brioche Lumbono', 2]]);
  assert.equal(sheet.products.some((p) => p.name === 'Amaretti Classici'), false);
});

test('Extra quantities join the batch and are shown by source', () => {
  const sheet = computeBakeSheet('2026-10-14', [demand('Brioche', 7), { ...demand('Brioche', 6, 'extra'), reason: 'Freezer stock' }], DATA);
  const b = sheet.recipes[0];
  assert.equal(b.products[0].qty, 13);
  close(b.total_dough_g, 13 * 265, 1e-9);
  assert.deepEqual(b.products[0].by_source.map((s) => s.source), ['web', 'extra']);
});

test('One-off adjustment: water 75 → 72 % only for this day; the piece weight stays, other grams shift', () => {
  const waterItem = STOCKDORF.items.find((i) => i.ingredient_id === 'ing-Water' && !i.label)!;
  const base = computeBakeSheet('2026-10-14', [demand('Stockdorf Sourdough', 2)], DATA).recipes[0];
  const adj = computeBakeSheet('2026-10-14', [demand('Stockdorf Sourdough', 2)], DATA, [{ recipe_id: STOCKDORF.id, item_id: waterItem.id, pct: 72 }]).recipes[0];
  close(adj.sum_pct, 216.85, 1e-9);
  assert.ok(adj.factor > base.factor);
  assert.equal(adj.adjustments_applied, 1);
  const w = adj.lines.find((l) => l.item_id === waterItem.id)!;
  assert.equal(w.adjusted, true); assert.equal(w.original_pct, 75);
  close(adj.total_dough_g, base.total_dough_g, 1e-9);
  // A stored adjustment equal to the recipe value (recipe changed to the same value afterwards) no longer counts as adjusted.
  const same = computeBakeSheet('2026-10-14', [demand('Stockdorf Sourdough', 2)], DATA, [{ recipe_id: STOCKDORF.id, item_id: waterItem.id, pct: 75 }]).recipes[0];
  assert.equal(same.adjustments_applied, 0);
  assert.equal(same.lines.find((l) => l.item_id === waterItem.id)!.adjusted, false);
});

test('Make-batch calculator: 40 g egg white → 260 g dough → 26 balls', () => {
  const p = previewForBaseAmount(AMARETTI, 'ing-Egg white', 40, DATA);
  close(p.total_g, 260, 1e-9);
  assert.equal(Math.floor(p.total_g / 10), 26);
  close(p.lines.find((l) => l.ingredient_name === 'Almond flour')!.grams, 114.4, 1e-9);
});

test('Validation: circular sub-recipes and sub margin misuse are reported', () => {
  const a: Recipe = recipe('A', 'sub', [{ id: 'x1', position: 1, type: 'sub', ingredient_id: null, sub_recipe_id: 'rec-B', starter_id: null, final_flour_ingredient_id: null, pct: 50, label: null }], { dough_margin_factor: 0.05 });
  const b: Recipe = recipe('B', 'sub', [{ id: 'x2', position: 1, type: 'sub', ingredient_id: null, sub_recipe_id: 'rec-A', starter_id: null, final_flour_ingredient_id: null, pct: 50, label: null }]);
  const errors = validateRecipe(a, { ...DATA, recipes: [...DATA.recipes, a, b] });
  assert.ok(errors.some((e) => e.startsWith('Circular')), errors.join('; '));
  assert.ok(errors.some((e) => e.includes('dough_margin_factor')), errors.join('; '));
  assert.equal(validateRecipe(STOCKDORF, DATA).length, 0);
});
