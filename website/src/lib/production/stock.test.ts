import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayConsumption, earliestBbf, ingredientPrices, parseEuro, perUnitAmounts, planBatch, productCost, stockLevels, stockRows } from './stock.ts';
import type { BakeSheet, Batch, Delivery, Ingredient, LedgerRow, ProductLink, ProductionData, Recipe } from './types';

const ing = (id: string, name: string, extra: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, unit: 'g', name_de: null, allergens: [], components_de: null, derived_from: null, g_per_source_unit: null, notes: null, track_stock: true, track_bbf: false, reorder_level: null, made_from_recipe_id: null, ...extra });

const flour = ing('flour', 'Wheat flour'), water = ing('water', 'Water', { track_stock: false }), salt = ing('salt', 'Salt');
const egg = ing('egg', 'Egg', { unit: 'pcs', track_stock: false });
const yolk = ing('yolk', 'Egg yolk', { derived_from: 'egg', g_per_source_unit: 17, track_stock: false });
const sesame = ing('sesame', 'Sesame', { track_bbf: true, reorder_level: 500 });

const dough: Recipe = { id: 'r', name: 'Dough', kind: 'dough', base_ingredient_id: null, dough_margin_factor: null, build_margin_pct: null, max_batch_g: null, per_batch_items: [], current_version: 1, notes: null,
  items: [
    { id: 'i1', position: 1, type: 'ingredient', ingredient_id: 'flour', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 100, label: null },
    { id: 'i2', position: 2, type: 'ingredient', ingredient_id: 'water', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 60, label: null },
    { id: 'i3', position: 3, type: 'ingredient', ingredient_id: 'yolk', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 34, label: null },
    { id: 'i4', position: 4, type: 'sub', ingredient_id: null, sub_recipe_id: 'p', starter_id: null, final_flour_ingredient_id: null, pct: 6, label: null },
  ] };
const poolish: Recipe = { ...dough, id: 'p', name: 'Poolish', kind: 'sub', build_margin_pct: 0,
  items: [{ id: 'p1', position: 1, type: 'ingredient', ingredient_id: 'salt', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 100, label: null }] };
const product: ProductLink = { id: 'prod', product_id: 'shop', name: 'Loaf', channel: 'web', recipe_id: 'r', dough_per_unit_g: 400, bake_loss_pct: null, extras: [{ ingredient_id: 'sesame', grams: 5 }], production: 'orders', pieces_per_unit: null, pieces_from_shop: false, link_status: 'linked', b2b_net_price_cents: null };
const data: ProductionData = { ingredients: [flour, water, salt, egg, yolk, sesame], starters: [], recipes: [dough, poolish], products: [product], settings: { dough_margin_factor: 0.05, build_margin_pct: 10, final_build_margin_pct: 10 } };

const delivery = (id: string, date: string, fee: number, lines: { ingredient_id: string; qty: number; pack: number; price: number; bbf?: string }[], status: Delivery['status'] = 'confirmed'): Delivery => ({
  id, supplier_id: 's1', date, invoice_no: null, delivery_fee_cents: fee, status, source: 'manual', file_path: null, notes: null, confirmed_at: null,
  lines: lines.map((l, i) => ({ position: i, ingredient_id: l.ingredient_id, item_text: null, qty: l.qty, pack_amount: l.pack, amount: l.qty * l.pack, price_cents: l.price, bbf: l.bbf ?? null })),
});
const deliveries = [
  delivery('d1', '2026-10-01', 1000, [{ ingredient_id: 'flour', qty: 1, pack: 25000, price: 2000, bbf: '2027-03-01' }, { ingredient_id: 'sesame', qty: 2, pack: 1000, price: 1600, bbf: '2027-01-15' }]),
  delivery('d2', '2026-10-20', 500, [{ ingredient_id: 'flour', qty: 2, pack: 25000, price: 5000, bbf: '2027-06-01' }]),
  delivery('d3', '2026-10-25', 0, [{ ingredient_id: 'flour', qty: 1, pack: 25000, price: 9999 }], 'draft'),
];

test('prices: newest confirmed line wins; delivery fee spread over the lines; previous price for the trend; drafts ignored', () => {
  const p = ingredientPrices(deliveries);
  const f = p.get('flour')!;
  assert.equal(f.unit_price, 5000 / 50000);          // 0.1 ct/g = 1,00 €/kg
  assert.equal(f.delivery_share, 500 / 1 / 50000);   // d2 has one line
  assert.equal(f.previous_unit_price, 2000 / 25000);
  assert.equal(f.date, '2026-10-20');
  const s = p.get('sesame')!;
  assert.equal(s.unit_price, 1600 / 2000);
  assert.equal(s.delivery_share, 1000 / 2 / 2000);   // d1: fee 10 € over 2 lines
  assert.equal(s.previous_unit_price, null);
});

test('stock levels sum the ledger; best-before is the earliest among the newest lines covering the level (FIFO)', () => {
  const ledger: LedgerRow[] = [
    { id: 'l1', ingredient_id: 'flour', date: '2026-10-01', kind: 'purchase', amount: 25000, ref_type: 'delivery_line', ref_id: 'x', note: null, created_at: '' },
    { id: 'l2', ingredient_id: 'flour', date: '2026-10-20', kind: 'purchase', amount: 50000, ref_type: 'delivery_line', ref_id: 'y', note: null, created_at: '' },
    { id: 'l3', ingredient_id: 'flour', date: '2026-10-21', kind: 'consumption', amount: -30000, ref_type: 'bake_day', ref_id: '2026-10-21', note: null, created_at: '' },
    { id: 'l4', ingredient_id: 'sesame', date: '2026-10-01', kind: 'purchase', amount: 2000, ref_type: null, ref_id: null, note: null, created_at: '' },
    { id: 'l5', ingredient_id: 'sesame', date: '2026-10-28', kind: 'count', amount: -1700, ref_type: null, ref_id: null, note: null, created_at: '' },
  ];
  const lv = stockLevels(ledger);
  assert.equal(lv.get('flour'), 45000);
  assert.equal(lv.get('sesame'), 300);
  // 45 kg left: the 50 kg of 20.10. cover it → bbf of that delivery, the old sack is gone
  assert.equal(earliestBbf('flour', 45000, deliveries), '2027-06-01');
  // 60 kg left would reach into the old sack → its earlier date
  assert.equal(earliestBbf('flour', 60000, deliveries), '2027-03-01');
  assert.equal(earliestBbf('flour', 0, deliveries), null);
  const rows = stockRows(data, ledger, deliveries, '2026-12-16');
  const ses = rows.find((r) => r.ingredient_id === 'sesame')!;
  assert.equal(ses.low, true);                        // 300 < 500
  assert.equal(ses.bbf, '2027-01-15'); assert.equal(ses.bbf_days, 30);
  assert.deepEqual(rows.map((r) => r.ingredient_id), ['flour', 'salt', 'sesame']);   // water/egg not tracked, yolk derived
});

test('per-unit amounts: recipe for one unit, sub with its build margin, yolk charged as whole eggs, extras once', () => {
  const { amounts, blocked } = perUnitAmounts(product, data);
  assert.equal(blocked, null);
  const factor = 400 / 200;                           // Σ% = 100+60+34+6
  assert.equal(amounts.get('flour'), 100 * factor);
  assert.equal(amounts.get('water'), 60 * factor);
  assert.equal(amounts.get('egg'), 34 * factor / 17); // 4 eggs' worth of yolk, not rounded
  assert.equal(amounts.get('salt'), 6 * factor);      // poolish margin 0 %
  assert.equal(amounts.get('sesame'), 5);
  assert.equal(perUnitAmounts({ ...product, recipe_id: null }, data).blocked, 'no recipe');
  assert.equal(perUnitAmounts({ ...product, dough_per_unit_g: 0 }, data).blocked, 'raw mass not set');
});

test('product cost: goods and delivery share apart; ingredients without a price are listed as missing', () => {
  const prices = ingredientPrices(deliveries);
  const c = productCost(product, data, prices);
  const flourG = 200, sesameG = 5;
  assert.equal(c.goods_cents, flourG * (5000 / 50000) + sesameG * (1600 / 2000));
  assert.equal(c.delivery_cents, flourG * (500 / 50000) + sesameG * (500 / 2000));   // d1: 10 € fee over 2 lines = 5 € per line
  assert.deepEqual(c.missing, ['Egg', 'Salt']);   // water is never priced
  assert.equal(c.lines[0].name, 'Wheat flour');
});

test('day consumption from the frozen sheet: lines × batches, derived lines as whole eggs, starter flour + water, extras', () => {
  const sheet: BakeSheet = { date: '2026-10-21', warnings: [], products: [], stock_products: [], starters: [], totals: { eggs: 0 }, versions: {}, recipes: [{
    recipe_id: 'r', name: 'Dough', version: 1, products: [], total_dough_g: 0, sum_pct: 0, dough_margin_factor: 0, margin_g_per_batch: 0, batches: 2, max_batch_g: null, per_batch_dough_g: 0, factor: 1, batch_total_g: 0,
    lines: [
      { item_id: 'i1', label: 'Wheat flour', ingredient_id: 'flour', ingredient_name: 'Wheat flour', unit: 'g', pct: 100, grams: 1000 },
      { item_id: 'i3', label: 'Egg yolk', ingredient_id: 'yolk', ingredient_name: 'Egg yolk', unit: 'g', pct: 34, grams: 85, source_units: 5, source_units_rounded: 5, source_name: 'Egg' },
    ],
    subs: [{ recipe_id: 'p', name: 'Poolish', version: 1, item_id: 'i4', pct: 6, needed_g: 60, build_margin_pct: 0, total_g: 60, sum_pct: 100, factor: 1, lines: [{ item_id: 'p1', label: 'Salt', ingredient_id: 'salt', ingredient_name: 'Salt', unit: 'g', pct: 100, grams: 60 }], subs: [], starters: [] }],
    starters: [{ starter_id: 's', starter_name: 'LL', item_id: 'x', label: 'LL', in_dough_g: 100, final_build_g: 110, flour_ingredient_id: 'flour', flour_ingredient_name: 'Wheat flour', flour_g: 50, water_g: 50, seed_g: 10 }],
    per_batch_items: [{ ingredient_id: 'egg', ingredient_name: 'Egg', unit: 'pcs', amount: 1 }],
    extras: [{ pr_product_id: 'prod', product_name: 'Loaf', qty: 3, lines: [{ ingredient_id: 'sesame', ingredient_name: 'Sesame', unit: 'g', per_piece: 5, total: 15 }] }],
    eggs_per_batch: 0, adjustments_applied: 0,
  }] };
  const c = dayConsumption(sheet, data);
  assert.equal(c.get('flour'), 2000 + 100);
  assert.equal(c.get('egg'), 10 + 2);
  assert.equal(c.get('salt'), 120);
  assert.equal(c.get('water'), 100);
  assert.equal(c.get('sesame'), 15);
  assert.equal(c.has('yolk'), false);
});

test('parseEuro', () => {
  assert.equal(parseEuro('12,50'), 1250);
  assert.equal(parseEuro('12.5'), 1250);
  assert.equal(parseEuro('1.234,56 €'), 123456);
  assert.equal(parseEuro(''), null);
  assert.ok(Number.isNaN(parseEuro('abc')));
});

// ---------- in-house batches ----------

const sugar = ing('sugar', 'Sugar'), vanilla = ing('vanilla', 'Vanilla'), lemon = ing('lemon', 'Lemon', { track_stock: false });
const vanillaSugar = ing('vsugar', 'Vanilla sugar (homemade)', { made_from_recipe_id: 'rv' });
const lemonSugar = ing('lsugar', 'Lemon sugar (homemade)', { made_from_recipe_id: 'rl' });
const vanillaRecipe: Recipe = { ...poolish, id: 'rv', name: 'Vanilla sugar', items: [
  { id: 'v1', position: 1, type: 'ingredient', ingredient_id: 'sugar', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 98, label: null },
  { id: 'v2', position: 2, type: 'ingredient', ingredient_id: 'vanilla', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 2, label: null },
] };
const lemonRecipe: Recipe = { ...poolish, id: 'rl', name: 'Lemon sugar', items: [
  { id: 'l1', position: 1, type: 'ingredient', ingredient_id: 'sugar', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 90, label: null },
  { id: 'l2', position: 2, type: 'ingredient', ingredient_id: 'lemon', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 10, label: null },
] };
const brioche: Recipe = { ...dough, id: 'rb', name: 'Brioche', items: [
  { id: 'b1', position: 1, type: 'ingredient', ingredient_id: 'flour', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 100, label: null },
  { id: 'b2', position: 2, type: 'ingredient', ingredient_id: 'vsugar', sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 10, label: null },
] };
const briocheProduct: ProductLink = { ...product, id: 'pb', name: 'Brioche', recipe_id: 'rb', dough_per_unit_g: 110, extras: [] };
const data2: ProductionData = { ...data, ingredients: [...data.ingredients, sugar, vanilla, lemon, vanillaSugar, lemonSugar], recipes: [...data.recipes, vanillaRecipe, lemonRecipe, brioche], products: [briocheProduct] };
const sugarDeliveries = [
  ...deliveries,
  delivery('d4', '2026-10-15', 200, [{ ingredient_id: 'sugar', qty: 1, pack: 10000, price: 1500 }, { ingredient_id: 'vanilla', qty: 1, pack: 50, price: 2500 }]),   // 1,50 €/kg sugar, 50 €/kg vanilla, 1 € fee each
];

test('planBatch: recipe percentages sum up to the made amount, priced from the components, goods and delivery apart', () => {
  const p = planBatch('vsugar', 1000, data2, ingredientPrices(sugarDeliveries));
  assert.equal(p.error, null);
  assert.deepEqual(p.lines.map((l) => [l.name, l.amount]), [['Sugar', 980], ['Vanilla', 20]]);
  assert.equal(Math.round(p.goods_cents), 147 + 1000);           // 980 g × 0,15 ct + 20 g × 50 ct
  assert.equal(Math.round(p.delivery_cents * 100) / 100, Math.round((980 * 100 / 10000 + 20 * 100 / 50) * 100) / 100);  // 9,8 ct + 40 ct
  assert.deepEqual(p.missing, []);
});

test('planBatch: a component without a price is listed as missing; water is free; not homemade / circular are errors', () => {
  const p = planBatch('lsugar', 500, data2, ingredientPrices(sugarDeliveries));
  assert.deepEqual(p.missing, ['Lemon']);
  assert.equal(p.lines.find((l) => l.name === 'Lemon')!.amount, 50);
  assert.match(planBatch('sugar', 100, data2, new Map()).error!, /no recipe/);
  const loop: ProductionData = { ...data2, recipes: [...data2.recipes, { ...vanillaRecipe, id: 'rx', items: [{ ...vanillaRecipe.items[0], ingredient_id: 'vsugar' }] }], ingredients: data2.ingredients.map((i) => (i.id === 'vsugar' ? { ...i, made_from_recipe_id: 'rx' } : i)) };
  assert.match(planBatch('vsugar', 100, loop, new Map()).error!, /itself/);
  assert.match(planBatch('vsugar', 0, data2, new Map()).error!, /Amount/);
});

test('a booked batch prices its ingredient like a delivery line, newest wins, and the product cost uses it', () => {
  const batches: Batch[] = [
    { id: 'b1', ingredient_id: 'vsugar', recipe_id: 'rv', date: '2026-10-20', amount: 1000, goods_cents: 1147, delivery_cents: 50, lines: [], note: null, created_at: '2026-10-20T10:00:00Z' },
    { id: 'b2', ingredient_id: 'vsugar', recipe_id: 'rv', date: '2026-10-28', amount: 500, goods_cents: 600, delivery_cents: 25, lines: [], note: null, created_at: '2026-10-28T10:00:00Z' },
  ];
  const prices = ingredientPrices(sugarDeliveries, batches);
  const v = prices.get('vsugar')!;
  assert.equal(v.unit_price, 600 / 500);
  assert.equal(v.delivery_share, 25 / 500);
  assert.equal(v.previous_unit_price, 1147 / 1000);
  assert.equal(v.source, 'batch');
  assert.equal(prices.get('sugar')!.source, 'delivery');
  const c = productCost(briocheProduct, data2, prices);
  assert.deepEqual(c.missing, []);
  assert.equal(Math.round(c.goods_cents * 100) / 100, Math.round((100 * 5000 / 50000 + 10 * 600 / 500) * 100) / 100);   // flour 10 ct + vanilla sugar 12 ct
  assert.equal(c.lines.find((l) => l.name === 'Vanilla sugar (homemade)')!.amount, 10);
});

test('ledger: a batch adds the made amount and removes the components', () => {
  const ledger: LedgerRow[] = [
    { id: '1', ingredient_id: 'sugar', date: '2026-10-15', kind: 'purchase', amount: 10000, ref_type: 'delivery_line', ref_id: 'x', note: null, created_at: '' },
    { id: '2', ingredient_id: 'vsugar', date: '2026-10-20', kind: 'batch', amount: 1000, ref_type: 'batch', ref_id: 'b1', note: null, created_at: '' },
    { id: '3', ingredient_id: 'sugar', date: '2026-10-20', kind: 'batch', amount: -980, ref_type: 'batch', ref_id: 'b1', note: null, created_at: '' },
    { id: '4', ingredient_id: 'vanilla', date: '2026-10-20', kind: 'batch', amount: -20, ref_type: 'batch', ref_id: 'b1', note: null, created_at: '' },
  ];
  const l = stockLevels(ledger);
  assert.equal(l.get('sugar'), 9020); assert.equal(l.get('vsugar'), 1000); assert.equal(l.get('vanilla'), -20);
});
