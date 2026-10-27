/** Freezer counter — the owner's baby-brioche case (18.10.2026) and the amaretti rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezerStatus, suggestBatch, oldestRemainingBatch, counterOf } from './freezer.ts';
import type { FreezerMovement } from './freezer.ts';
import type { ProductLink } from './types.ts';

const baby: ProductLink = { id: 'baby', product_id: null, name: 'Baby-Brioche Lumbono', channel: 'intern', recipe_id: 'r', dough_per_unit_g: 50, bake_loss_pct: null, extras: [], production: 'stock', pieces_per_unit: null, pieces_from_shop: false, link_status: 'internal' };
const amaretti: ProductLink = { ...baby, id: 'am', name: 'Amaretti Classici', pieces_per_unit: 5 };
const babySettings = { pr_product_id: 'baby', batch_size: 6, min_level: 2, max_age_days: null };
const mv = (date: string, kind: FreezerMovement['kind'], qty: number): FreezerMovement => ({ id: `${date}-${kind}`, pr_product_id: 'baby', date, kind, qty, note: null });

test('suggestBatch rounds up to whole batches', () => {
  assert.equal(suggestBatch(0, 2, 6), 6);
  assert.equal(suggestBatch(2, 2, 6), 0);
  assert.equal(suggestBatch(-5, 2, 6), 12);
  assert.equal(suggestBatch(10, 15, 26), 26);
});

test('Wed 21.10.: 2 in stock, Sat takes 2 → projected 0 < min 2 → bake 6 extra', () => {
  const s = freezerStatus(baby, babySettings, [mv('2026-10-18', 'count', 2)], '2026-10-21', 0, 0, [{ date: '2026-10-24', pieces: 2, who: 'Lumbono 2' }]);
  assert.equal(s.counter, 2);
  assert.equal(s.after_today, 2);
  assert.equal(s.projected, 0);
  assert.equal(s.suggestion, 6);
});

test('planned extra of 6 silences the suggestion; confirming the batch books it', () => {
  const planned = freezerStatus(baby, babySettings, [mv('2026-10-18', 'count', 2)], '2026-10-21', 0, 6, [{ date: '2026-10-24', pieces: 2, who: 'Lumbono 2' }]);
  assert.equal(planned.suggestion, 0);
  assert.equal(planned.after_today, 2);                 // not yet confirmed → not counted
  const booked = freezerStatus(baby, babySettings, [mv('2026-10-18', 'count', 2), mv('2026-10-21', 'batch', 6)], '2026-10-21', 0, 6, [{ date: '2026-10-24', pieces: 2, who: 'Lumbono 2' }]);
  assert.equal(booked.batch_today, 6);
  assert.equal(booked.after_today, 8);
  assert.equal(booked.projected, 6);
  assert.equal(booked.suggestion, 0);
});

test('Sat 24.10.: usage 2 today, booked once when the day is frozen', () => {
  const live = freezerStatus(baby, babySettings, [mv('2026-10-18', 'count', 2), mv('2026-10-21', 'batch', 6)], '2026-10-24', 2, 0, []);
  assert.equal(live.counter, 8); assert.equal(live.usage_today, 2); assert.equal(live.after_today, 6); assert.equal(live.usage_booked_today, false);
  const frozen = freezerStatus(baby, babySettings, [mv('2026-10-18', 'count', 2), mv('2026-10-21', 'batch', 6), mv('2026-10-24', 'usage', -2)], '2026-10-24', 2, 0, []);
  assert.equal(frozen.usage_booked_today, true); assert.equal(frozen.after_today, 6);   // not double counted
  assert.equal(counterOf([mv('2026-10-18', 'count', 2), mv('2026-10-21', 'batch', 6), mv('2026-10-24', 'usage', -2)]), 6);
});

test('amaretti: bags → balls, 28-day FIFO age warning', () => {
  const settings = { pr_product_id: 'am', batch_size: 26, min_level: 15, max_age_days: 28 };
  const moves: FreezerMovement[] = [
    { id: '1', pr_product_id: 'am', date: '2026-09-10', kind: 'batch', qty: 26, note: null },
    { id: '2', pr_product_id: 'am', date: '2026-10-01', kind: 'batch', qty: 26, note: null },
    { id: '3', pr_product_id: 'am', date: '2026-10-07', kind: 'usage', qty: -20, note: null },
  ];
  assert.equal(oldestRemainingBatch(moves), '2026-09-10');          // 6 of the first batch left
  const s = freezerStatus(amaretti, settings, moves, '2026-10-14', 20, 0, [{ date: '2026-10-17', pieces: 10, who: 'web 2' }]);
  assert.equal(s.counter, 32); assert.equal(s.after_today, 12); assert.equal(s.projected, 2);
  assert.equal(s.suggestion, 26);
  assert.equal(s.oldest_batch_age_days, 34); assert.equal(s.too_old, true);
  const later: FreezerMovement[] = [...moves, { id: '4', pr_product_id: 'am', date: '2026-10-14', kind: 'usage', qty: -20, note: null }];
  assert.equal(oldestRemainingBatch(later), '2026-10-01');          // first batch fully used
});
