import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchInvoice, tokens, toUnit, type ExtractedInvoice } from './invoiceMatch.ts';
import type { Ingredient, ProductionData } from './types';

const ing = (id: string, name: string, name_de: string | null, extra: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, unit: 'g', name_de, allergens: [], components_de: null, derived_from: null, g_per_source_unit: null, notes: null, track_stock: true, track_bbf: false, reorder_level: null, made_from_recipe_id: null, ...extra });
const data: ProductionData = {
  ingredients: [
    ing('t55', 'Wheat flour T55/550', '**Weizen**mehl', { track_bbf: true }),
    ing('t80', 'Wheat flour T80/1050', '**Weizen**mehl 1050', { track_bbf: true }),
    ing('spelt', 'Spelt flour T65/630', '**Dinkel**mehl 630', { track_bbf: true }),
    ing('sesame', 'Sesame', '**Sesam**', { track_bbf: true }),
    ing('sesame_b', 'Sesame black', '**Sesam** (schwarz und weiß)', { track_bbf: true }),   // shared German label, as in the real data
    ing('sesame_w', 'Sesame white', '**Sesam** (schwarz und weiß)', { track_bbf: true }),
    ing('egg', 'Egg', 'Ei', { unit: 'pcs', track_stock: false }),
    ing('yolk', 'Egg yolk', 'Eigelb', { derived_from: 'egg', g_per_source_unit: 17 }),
    ing('butter', 'Butter', 'Butter'),
  ],
  starters: [], recipes: [], products: [], settings: { dough_margin_factor: 0.05, build_margin_pct: 10, final_build_margin_pct: 10 },
};
const suppliers = [{ id: 's1', name: 'Mühle Müller', notes: null }, { id: 's2', name: 'Metro', notes: null }];
const items = [{ supplier_id: 's1', ingredient_id: 't55', item_text: 'Weizenmehl Type 550 25 kg Sack', pack_amount: 25000 }];

test('tokens: lowercase, strips markers and type prefixes, keeps numbers', () => {
  assert.deepEqual(tokens('**Weizen**mehl T550'), ['wheat', 'weizenmehl', '550']);
  assert.deepEqual(tokens('Dinkelmehl 630 Bio 25 kg'), ['spelt', 'dinkelmehl', '630', '25']);
  assert.deepEqual(tokens('Sesam weiß geschält'), ['sesame', 'sesam', 'white', 'weiß']);
});

test('toUnit converts to the ingredient unit', () => {
  assert.equal(toUnit(25, 'kg', 'g'), 25000);
  assert.equal(toUnit(500, 'g', 'g'), 500);
  assert.equal(toUnit(1, 'l', 'g'), 1000);
  assert.equal(toUnit(30, 'pcs', 'pcs'), 30);
  assert.equal(toUnit(10, 'pcs', 'g'), null);
  assert.equal(toUnit(null, 'kg', 'g'), null);
});

test('matches supplier, remembered wording, names by word overlap; fee kept apart; bbf only where tracked', () => {
  const x: ExtractedInvoice = {
    supplier: 'Mühle Müller GmbH', invoice_date: '2026-10-28', invoice_no: 'R-2026-1234', delivery_fee_net_cents: null,
    lines: [
      { description: 'Weizenmehl Type 550 25 kg Sack', quantity: 2, pack_size_value: 25, pack_size_unit: 'kg', line_net_cents: 4200, best_before: '2027-05-01', is_fee_or_deposit: false },
      { description: 'Dinkelmehl 630 5kg', quantity: 1, pack_size_value: 5, pack_size_unit: 'kg', line_net_cents: 1100, best_before: null, is_fee_or_deposit: false },
      { description: 'Eier Freiland 30er', quantity: 2, pack_size_value: 30, pack_size_unit: 'pcs', line_net_cents: 1800, best_before: '2026-11-10', is_fee_or_deposit: false },
      { description: 'Lieferpauschale', quantity: 1, pack_size_value: null, pack_size_unit: null, line_net_cents: 890, best_before: null, is_fee_or_deposit: true },
      { description: 'Pfand Kiste', quantity: 1, pack_size_value: null, pack_size_unit: null, line_net_cents: 300, best_before: null, is_fee_or_deposit: true },
      { description: 'Kokosflocken 1 kg', quantity: 1, pack_size_value: 1, pack_size_unit: 'kg', line_net_cents: 700, best_before: null, is_fee_or_deposit: false },
      { description: 'Sesam weiß geschält 1 kg', quantity: 1, pack_size_value: 1, pack_size_unit: 'kg', line_net_cents: 620, best_before: null, is_fee_or_deposit: false },
    ],
  };
  const m = matchInvoice(x, data, suppliers, items, '2026-10-29');
  assert.equal(m.supplier_id, 's1');
  assert.equal(m.date, '2026-10-28');
  assert.equal(m.invoice_no, 'R-2026-1234');
  assert.equal(m.delivery_fee_cents, 890);          // the deposit is not a delivery fee
  assert.equal(m.lines.length, 5);
  assert.equal(m.lines[4].ingredient_id, 'sesame_w');   // the colour word in the INTERNAL name decides between the three sesames
  assert.deepEqual(m.lines[0], { ingredient_id: 't55', item_text: 'Weizenmehl Type 550 25 kg Sack', qty: 2, pack_amount: 25000, price_cents: 4200, bbf: '2027-05-01', how: 'remembered' });
  assert.equal(m.lines[1].ingredient_id, 'spelt'); assert.equal(m.lines[1].pack_amount, 5000); assert.equal(m.lines[1].how, 'name');
  assert.equal(m.lines[2].ingredient_id, 'egg'); assert.equal(m.lines[2].pack_amount, 30); assert.equal(m.lines[2].bbf, null);   // "Eier" → egg; eggs: no bbf tracking
  assert.equal(m.lines[3].ingredient_id, null); assert.equal(m.lines[3].how, 'none');
  assert.ok(m.notes.some((n) => n.includes('Kokosflocken')));
});

test('unknown supplier → note with the name; missing date → today; 1050 beats 550 on numbers', () => {
  const x: ExtractedInvoice = { supplier: 'Neuer Lieferant', invoice_date: null, invoice_no: null, delivery_fee_net_cents: 500,
    lines: [{ description: 'Weizenmehl 1050 25 kg', quantity: 1, pack_size_value: 25, pack_size_unit: 'kg', line_net_cents: 2000, best_before: null, is_fee_or_deposit: false }] };
  const m = matchInvoice(x, data, suppliers, items, '2026-10-29');
  assert.equal(m.supplier_id, null); assert.equal(m.supplier_name, 'Neuer Lieferant');
  assert.ok(m.notes[0].includes('new'));
  assert.equal(m.date, '2026-10-29');
  assert.equal(m.delivery_fee_cents, 500);
  assert.equal(m.lines[0].ingredient_id, 't80');
});
