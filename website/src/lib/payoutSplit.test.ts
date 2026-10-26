import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apportion, orderGrossSplit, splitTransactionAmount, rateKey, euro } from './payoutSplit.ts';

test('rateKey maps numeric and string rates', () => {
  assert.equal(rateKey(0.07), 7);
  assert.equal(rateKey('0.07'), 7);
  assert.equal(rateKey(0.19), 19);
  assert.equal(rateKey(0), null);
  assert.equal(rateKey(null), null);
});

test('apportion sums exactly to the total (largest remainder)', () => {
  const r = apportion(100, { a: 1, b: 1, c: 1 }, 'a');
  assert.equal(r.a + r.b + r.c, 100);
  assert.deepEqual(r, { a: 34, b: 33, c: 33 });
});

test('apportion keeps the sign for refunds', () => {
  const r = apportion(-1001, { 7: 3, 19: 1 }, 7);
  assert.deepEqual(r, { 7: -751, 19: -250 });
});

test('apportion with zero weights falls back', () => {
  assert.deepEqual(apportion(500, { 7: 0, 19: 0 }, 7), { 7: 500, 19: 0 });
  assert.deepEqual(apportion(0, { 7: 0, 19: 0 }, 7), { 7: 0, 19: 0 });
});

test('orderGrossSplit: all 7 %, no discount', () => {
  const s = orderGrossSplit([
    { quantity: 2, unit_price_cents: 650, unit_price_gross_cents: 650, vat_rate: 0.07 },
    { quantity: 1, unit_price_cents: 765, unit_price_gross_cents: 765, vat_rate: 0.07 },
  ], 2065);
  assert.deepEqual(s, { 7: 2065, 19: 0, other: 0 });
});

test('orderGrossSplit: mixed rates with a discount spread proportionally', () => {
  // 800 @7 % + 200 @19 % = 1000 gross, 10 % discount → charged 900
  const s = orderGrossSplit([
    { quantity: 1, unit_price_cents: 800, vat_rate: 0.07 },
    { quantity: 1, unit_price_cents: 200, vat_rate: '0.19' },
  ], 900);
  assert.deepEqual(s, { 7: 720, 19: 180, other: 0 });
});

test('orderGrossSplit: legacy items without unit_price_gross_cents', () => {
  const s = orderGrossSplit([{ quantity: 3, unit_price_cents: 200, vat_rate: 0.07 }], 600);
  assert.deepEqual(s, { 7: 600, 19: 0, other: 0 });
});

test('splitTransactionAmount: partial refund follows the order proportions', () => {
  const r = splitTransactionAmount(-450, { 7: 720, 19: 180, other: 0 });
  assert.deepEqual(r, { 7: -360, 19: -90, other: 0 });
  assert.equal(splitTransactionAmount(100, null), null);
});

test('euro formatting', () => {
  assert.equal(euro(11262), '112,62');
  assert.equal(euro(-5), '-0,05');
  assert.equal(euro(0), '0,00');
});
