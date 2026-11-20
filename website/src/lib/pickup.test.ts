import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNextPickup, getNextPickupFor, nextSubscriptionRun, announcedClosure, closureBannerText,
  firstOpenPickupAfter, isClosedOn, isOfferedOn, isProductAvailableOn,
} from './pickup.ts';
import type { ClosureRange } from './pickup.ts';

// Berlin wall-clock instants (CET in November/December = +01:00).
const fri20 = new Date('2026-11-20T10:00:00+01:00');
const mon23late = new Date('2026-11-23T23:00:00+01:00');
const closure: ClosureRange = { start_date: '2026-11-25', end_date: '2026-12-01' };

test('no closure: Friday 20.11. orders for Wednesday 25.11.', () => {
  const p = getNextPickup(fri20);
  assert.equal(p.date, '2026-11-25');
  assert.equal(p.day, 'wednesday');
  assert.equal(p.cutoffLabel, 'Bestellschluss: Montag, 22:00 Uhr');
});

test('closure 25.11.–01.12.: the shop skips to Wednesday 02.12. and dates the cutoff', () => {
  const p = getNextPickup(fri20, [closure]);
  assert.equal(p.date, '2026-12-02');
  assert.equal(p.day, 'wednesday');
  assert.equal(p.label, 'Mittwoch, 2. Dezember');
  assert.equal(p.cutoffLabel, 'Bestellschluss: Montag, 30.11., 22:00 Uhr');
});

test('closure: after the Monday cutoff the date is still 02.12.', () => {
  assert.equal(getNextPickup(mon23late, [closure]).date, '2026-12-02');
});

test('closure: a Saturday-only location goes to Saturday 05.12.', () => {
  const p = getNextPickupFor({ available_wed: false, available_sat: true }, fri20, [closure]);
  assert.equal(p.date, '2026-12-05');
  assert.equal(p.cutoffLabel, 'Bestellschluss: Donnerstag, 03.12., 22:00 Uhr');
});

test('cutoff within a week keeps the short label', () => {
  const p = getNextPickup(new Date('2026-11-30T09:00:00+01:00'), [closure]);
  assert.equal(p.date, '2026-12-02');
  assert.equal(p.cutoffLabel, 'Bestellschluss: heute 22:00 Uhr');
});

test('isClosedOn is inclusive at both ends', () => {
  assert.equal(isClosedOn('2026-11-25', [closure]), true);
  assert.equal(isClosedOn('2026-12-01', [closure]), true);
  assert.equal(isClosedOn('2026-12-02', [closure]), false);
  assert.equal(isClosedOn('2026-11-24', [closure]), false);
});

test('announcedClosure: 14 days ahead, not after the end', () => {
  assert.deepEqual(announcedClosure([closure], '2026-11-20'), closure);
  assert.deepEqual(announcedClosure([closure], '2026-11-11'), closure);
  assert.equal(announcedClosure([closure], '2026-11-10'), null);
  assert.deepEqual(announcedClosure([closure], '2026-12-01'), closure);
  assert.equal(announcedClosure([closure], '2026-12-02'), null);
  const later: ClosureRange = { start_date: '2026-12-24', end_date: '2027-01-06' };
  assert.deepEqual(announcedClosure([later, closure], '2026-11-20'), closure);
});

test('closureBannerText: generated text names the dates and the next bake day', () => {
  assert.equal(
    closureBannerText(closure, [closure]),
    'Vom 25.11. bis 01.12. backen wir nicht. Nächster Abholtag: Mittwoch, 02.12.',
  );
  const one: ClosureRange = { start_date: '2026-11-25', end_date: '2026-11-25' };
  assert.equal(closureBannerText(one, [one]), 'Am 25.11. backen wir nicht. Nächster Abholtag: Samstag, 28.11.');
  assert.equal(closureBannerText({ ...closure, banner_text_de: ' Eigener Text ' }, [closure]), 'Eigener Text');
});

test('firstOpenPickupAfter skips a following closure too', () => {
  assert.equal(firstOpenPickupAfter('2026-12-01', []), '2026-12-02');
  const next: ClosureRange = { start_date: '2026-12-02', end_date: '2026-12-02' };
  assert.equal(firstOpenPickupAfter('2026-12-01', [closure, next]), '2026-12-05');
});

test('nextSubscriptionRun skips closed pickups', () => {
  const r = nextSubscriptionRun('wednesday', fri20, [closure]);
  assert.equal(r.orderDate, '2026-11-30');
  assert.equal(r.pickupDate, '2026-12-02');
  const both = nextSubscriptionRun('both', fri20, [closure]);
  assert.equal(both.pickupDate, '2026-12-02');
  assert.equal(nextSubscriptionRun('wednesday', fri20).pickupDate, '2026-11-25');
});

test('"wieder ab": hidden before the date, offered from the date on, also inside isProductAvailableOn', () => {
  const p = { cycle: 'permanent' as const, available_wed: true, available_sat: true, available_from: '2026-12-05' };
  assert.equal(isOfferedOn(p, '2026-12-02'), false);
  assert.equal(isOfferedOn(p, '2026-12-05'), true);
  assert.equal(isOfferedOn({ available_from: null }, '2026-12-02'), true);
  const wed = getNextPickup(fri20, [closure]); // 02.12.
  assert.equal(isProductAvailableOn(p, wed, 'A'), false);
  assert.equal(isProductAvailableOn({ ...p, available_from: null }, wed, 'A'), true);
});
