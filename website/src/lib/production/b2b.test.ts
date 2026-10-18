/** Step 2: standing orders, overrides, one-offs — the Lumbono case from the owner (18.10.2026). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planB2BDay, b2bDemands, weekdayOfISO } from './b2b.ts';
import type { B2BClient, StandingOrder, DayOverride, ManualOrder, ProductLink } from './types.ts';

const lumbono: B2BClient = { id: 'c1', name: 'Lumbono', notes: null, active: true };
const products: ProductLink[] = [
  { id: 'pizza', product_id: null, name: 'Pizza dough', channel: 'intern', recipe_id: 'r', dough_per_unit_g: 252, bake_loss_pct: null, extras: [], production: 'orders', pieces_per_unit: null, link_status: 'internal' },
  { id: 'foc', product_id: null, name: 'Focaccia Lumbono', channel: 'intern', recipe_id: 'r', dough_per_unit_g: 900, bake_loss_pct: null, extras: [], production: 'orders', pieces_per_unit: null, link_status: 'internal' },
  { id: 'baby', product_id: null, name: 'Baby-Brioche Lumbono', channel: 'intern', recipe_id: 'r', dough_per_unit_g: 50, bake_loss_pct: null, extras: [], production: 'stock', pieces_per_unit: null, link_status: 'internal' },
  { id: 'sem', product_id: null, name: 'Frühstückssemmeln', channel: 'intern', recipe_id: 'r', dough_per_unit_g: 110, bake_loss_pct: null, extras: [], production: 'orders', pieces_per_unit: null, link_status: 'internal' },
];
const standing: StandingOrder[] = [
  { id: 's1', client_id: 'c1', weekday: 3, items: [{ pr_product_id: 'pizza', qty: 10 }, { pr_product_id: 'foc', qty: 2 }], valid_from: null, valid_to: null, active: true, notes: null },
  { id: 's2', client_id: 'c1', weekday: 6, items: [{ pr_product_id: 'foc', qty: 2 }, { pr_product_id: 'baby', qty: 2 }, { pr_product_id: 'sem', qty: 3 }], valid_from: null, valid_to: null, active: true, notes: null },
];

test('weekday helper', () => {
  assert.equal(weekdayOfISO('2026-10-21'), 3); // Wednesday
  assert.equal(weekdayOfISO('2026-10-24'), 6); // Saturday
});

test('Lumbono standing orders land on the right weekday', () => {
  const wed = planB2BDay('2026-10-21', [lumbono], standing, [], []);
  assert.equal(wed.planned.length, 1);
  assert.deepEqual(wed.planned[0].items, [{ pr_product_id: 'pizza', qty: 10 }, { pr_product_id: 'foc', qty: 2 }]);
  assert.equal(wed.planned[0].source, 'standing');
  const sat = planB2BDay('2026-10-24', [lumbono], standing, [], []);
  assert.deepEqual(sat.planned[0].items.map((i) => i.qty), [2, 2, 3]);
  const mon = planB2BDay('2026-10-19', [lumbono], standing, [], []);
  assert.equal(mon.planned.length, 0);
});

test('override: skip (closed) and replace (more / less / other product)', () => {
  const skip: DayOverride = { id: 'o1', client_id: 'c1', date: '2026-10-21', skip: true, items: null, note: 'closed' };
  const s = planB2BDay('2026-10-21', [lumbono], standing, [skip], []);
  assert.equal(s.planned[0].skipped, true);
  assert.deepEqual(s.planned[0].items, []);
  assert.equal(b2bDemands(s, products, [lumbono]).length, 0);
  const more: DayOverride = { id: 'o2', client_id: 'c1', date: '2026-10-24', skip: false, items: [{ pr_product_id: 'foc', qty: 4 }, { pr_product_id: 'pizza', qty: 5 }], note: null };
  const m = planB2BDay('2026-10-24', [lumbono], standing, [more], []);
  assert.deepEqual(m.planned[0].items, [{ pr_product_id: 'foc', qty: 4 }, { pr_product_id: 'pizza', qty: 5 }]);
  assert.equal(m.planned[0].source, 'override');
  // the override applies only to its own date
  assert.equal(planB2BDay('2026-10-31', [lumbono], standing, [more], []).planned[0].source, 'standing');
});

test('validity window and inactive client / standing order', () => {
  const windowed = standing.map((s) => ({ ...s, valid_from: '2026-11-01', valid_to: '2026-11-30' }));
  assert.equal(planB2BDay('2026-10-21', [lumbono], windowed, [], []).planned.length, 0);
  assert.equal(planB2BDay('2026-11-04', [lumbono], windowed, [], []).planned.length, 1);
  assert.equal(planB2BDay('2026-12-02', [lumbono], windowed, [], []).planned.length, 0);
  assert.equal(planB2BDay('2026-10-21', [{ ...lumbono, active: false }], standing, [], []).planned.length, 0);
  assert.equal(planB2BDay('2026-10-21', [lumbono], standing.map((s) => ({ ...s, active: false })), [], []).planned.length, 0);
});

test('demands carry the client name; one-offs by type; unknown products are not dropped', () => {
  const manual: ManualOrder[] = [
    { id: 'm1', date: '2026-10-21', type: 'market', client_id: null, label: 'Stockdorf market', items: [{ pr_product_id: 'foc', qty: 1 }], notes: null },
    { id: 'm2', date: '2026-10-21', type: 'b2b', client_id: 'c1', label: null, items: [{ pr_product_id: 'gone', qty: 2 }], notes: null },
    { id: 'm3', date: '2026-10-22', type: 'own', client_id: null, label: null, items: [{ pr_product_id: 'foc', qty: 9 }], notes: null },
  ];
  const plan = planB2BDay('2026-10-21', [lumbono], standing, [], manual);
  const d = b2bDemands(plan, products, [lumbono]);
  assert.deepEqual(d.map((x) => [x.product_name, x.qty, x.source, x.reason]), [
    ['Pizza dough', 10, 'b2b', 'Lumbono'], ['Focaccia Lumbono', 2, 'b2b', 'Lumbono'],
    ['Focaccia Lumbono', 1, 'manual', 'market: Stockdorf market'], ['unknown product', 2, 'b2b', 'Lumbono'],
  ]);
  assert.equal(d[3].pr_product_id, null);
});
