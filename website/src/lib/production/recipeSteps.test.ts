import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseStepsRows, foldsAt, formatMinutes, normalizeSteps } from './recipeSteps.ts';

test('parseDuration: minutes, hours, ranges, Excel times, dashes', () => {
  assert.deepEqual(parseDuration('2min'), { min: 2, max: 2 });
  assert.deepEqual(parseDuration('90min'), { min: 90, max: 90 });
  assert.deepEqual(parseDuration('8-12uur'), { min: 480, max: 720 });
  assert.deepEqual(parseDuration('40-50min'), { min: 40, max: 50 });
  assert.deepEqual(parseDuration('0:40-0:50'), { min: 40, max: 50 });
  assert.deepEqual(parseDuration('8:00-12:00'), { min: 480, max: 720 });
  assert.deepEqual(parseDuration('1h30'), { min: 90, max: 90 });
  assert.deepEqual(parseDuration('1,5 h'), { min: 90, max: 90 });
  assert.deepEqual(parseDuration(0.0625), { min: 90, max: 90 });            // Excel 1:30
  assert.deepEqual(parseDuration(0.006944444444444444), { min: 10, max: 10 });
  assert.deepEqual(parseDuration(new Date(Date.UTC(1899, 11, 30, 1, 30))), { min: 90, max: 90 });   // exceljs time cell
  assert.deepEqual(parseDuration('-'), { min: null, max: null });
  assert.deepEqual(parseDuration('batardje'), { min: null, max: null });
});

test('foldsAt reads the 1@30 convention; formatMinutes prints ranges', () => {
  assert.deepEqual(foldsAt('22°C, 1@30, 1@60, 1@90'), [30, 60, 90]);
  assert.deepEqual(foldsAt('2@45'), [45, 45]);
  assert.deepEqual(foldsAt('22°C, afgedekt'), []);
  assert.equal(formatMinutes(90, 90), '1 h 30 min');
  assert.equal(formatMinutes(480, 720), '8 h – 12 h');
  assert.equal(formatMinutes(5, 5), '5 min');
});

test("parseStepsRows: the owner's Frühstückssemmel file layout", () => {
  const rows: unknown[][] = [
    ['Frühstückssemmel'], [null, 'Werkwijze'],
    ['Mengen', '2min', 'alle ingredienten samen, met de hand is genoeg'], ['Kneden', '-'],
    ['Bulkrijs', '90min', '22°C, 1@30, 1@60, 1@90'], ['Bulkrijs', '8-12uur', '22°C, afgedekt'],
    ['Verdelen', 106], ['Vormen', 'batardje'], ['Temperatuur', 'inschieten', 'bakken'], ['kap', '250°C', '220°C'], ['Baktijd', '20-25min', 'stomen'],
    [], ['Planning'], ['Task', 'Duration', 'Available for other task?'],
    ['Prepare', 0.006944444444444444, 'no'], ['Bulkrijs I', 0.0625, 'yes'], ['Bulkrijs II', '8:00-12:00', 'yes'], ['Narijs', '0:40-0:50', 'yes'], ['Uit oven halen', 0.003472222222222222, 'no'],
  ];
  const r = parseStepsRows(rows);
  assert.equal(r.name, 'Frühstückssemmel');
  assert.equal(r.steps.method.length, 9);
  assert.deepEqual(r.steps.method[2], { label: 'Bulkrijs', value: '90min', detail: '22°C, 1@30, 1@60, 1@90' });
  assert.deepEqual(r.steps.method[4], { label: 'Verdelen', value: '106', detail: '' });
  assert.deepEqual(r.steps.planning.map((p) => [p.task, p.duration, p.min_minutes, p.max_minutes, p.hands_free]), [
    ['Prepare', '10 min', 10, 10, false], ['Bulkrijs I', '1 h 30 min', 90, 90, true], ['Bulkrijs II', '8:00-12:00', 480, 720, true],
    ['Narijs', '0:40-0:50', 40, 50, true], ['Uit oven halen', '5 min', 5, 5, false],
  ]);
});

test('normalizeSteps tolerates junk and recomputes minutes from the duration text', () => {
  const s = normalizeSteps({ method: [{ label: ' Mengen ', value: 3 }, {}], planning: [{ task: 'Narijs', duration: '45min', hands_free: 'yes' }] });
  assert.deepEqual(s.method, [{ label: 'Mengen', value: '3', detail: '' }]);
  assert.deepEqual(s.planning, [{ task: 'Narijs', duration: '45min', min_minutes: 45, max_minutes: 45, hands_free: true }]);
  assert.deepEqual(normalizeSteps(null), { method: [], planning: [] });
});

test('parseStepsRows: header suffixes and two blocks per file (Ciabatta: vulling + ciabatta)', () => {
  const rows: unknown[][] = [
    ['Ciabatta'], [null, 'Werkwijze (vulling)'],
    ['Bereiden', 'Meng olijfringen met oregano.', 'Meng olijfringen met oregano.'], [null, 'Voeg na het kneden toe.', 'Voeg na het kneden toe.'],
    [], ['Planning (vulling)'], ['Task', 'Duration', 'Available for other task?'], ['Prepare', new Date(Date.UTC(1899, 11, 30, 0, 10)), 'no'],
    [], [null, 'Werkwijze ciabattta', 'Werkwijze ciabattta'],
    ['Mengen', '4min', 'water, bloem en top fournil', 'water, bloem en top fournil'], ['Verdelen', 424, 'gram per stuk', 'gram per stuk'],
    [], ['Planning'], ['Task', 'Duration', 'Available for other task?'], ['Prepare', new Date(Date.UTC(1899, 11, 30, 0, 10)), 'no'], ['Bulkrijs II', '14:00-20:00', 'yes'],
  ];
  const r = parseStepsRows(rows);
  assert.deepEqual(r.steps.method.map((m) => [m.label, m.value, m.detail]), [
    ['Werkwijze (vulling)', '', ''], ['Bereiden', 'Meng olijfringen met oregano.', ''], ['', 'Voeg na het kneden toe.', ''],
    ['Werkwijze ciabattta', '', ''], ['Mengen', '4min', 'water, bloem en top fournil'], ['Verdelen', '424', 'gram per stuk'],
  ]);
  assert.deepEqual(r.steps.planning.map((p) => [p.task, p.min_minutes, p.max_minutes, p.hands_free]), [
    ['Prepare (vulling)', 10, 10, false], ['Prepare', 10, 10, false], ['Bulkrijs II', 840, 1200, true],
  ]);
});
