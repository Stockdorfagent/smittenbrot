/**
 * CSV import against the owner's real files in ../../stock-tracking (18.10.2026)
 * and a copy of the live shop product names.
 *
 * Run: npm run test:production
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, parseNumber, parseItemList, planImport, detectSeparator } from './csvImport.ts';

const DIR = join(process.cwd(), '..', '..', 'stock-tracking');
const SHOP = [
  { id: 'p-amaretti-classici', name: 'Amaretti Classici', unit_label: '5 Stück' },
  { id: 'p-osterhase', name: 'Osterhase', unit_label: null },
  { id: 'p-crumble', name: 'Vollkorn Apple Crumble', unit_label: null },
  { id: 'p-weizenkleinbrot', name: 'Weizenkleinbrot', unit_label: null },
  { id: 'p-amaretti-cacao', name: 'Amaretti Cacao & Caffè', unit_label: '5 Stück' },
  { id: 'p-stockdorf', name: 'Stockdorf Sourdough', unit_label: null },
  { id: 'p-brioche', name: 'Brioche', unit_label: null },
  { id: 'p-focaccia-naturale', name: 'Focaccia Naturale', unit_label: null },
  { id: 'p-focaccia-pomodorini', name: 'Focaccia Pomodorini', unit_label: null },
  { id: 'p-rye', name: 'Rye & Wheat', unit_label: null },
  { id: 'p-spelt', name: 'Spelt Sourdough', unit_label: null },
  { id: 'p-ciabatta-naturale', name: 'Ciabatta Naturale', unit_label: null },
  { id: 'p-baguette', name: 'Baguette', unit_label: null },
  { id: 'p-ciabatta-olive', name: 'Ciabatta Olive & Origano', unit_label: null },
  { id: 'p-seeded', name: 'Seeded Sourdough', unit_label: null },
];

test('csv primitives: separator detection, quotes, decimal comma, item lists', () => {
  assert.equal(detectSeparator('a;b;c\n1;2;3'), ';');
  assert.equal(detectSeparator('a,b,c\n1,2,3'), ',');
  const rows = parseCsv('﻿item,name_de,components_de\r\nOlives,Oliven,"Oliven, Wasser, Salz"\r\nX,"Y ""quoted""",\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].components_de, 'Oliven, Wasser, Salz');
  assert.equal(rows[1].name_de, 'Y "quoted"');
  assert.equal(parseNumber('0.05'), 0.05);
  assert.equal(parseNumber('0,05'), 0.05);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
  const list = parseItemList('Flaked almonds=4|Pearl sugar=4|Egg=1');
  assert.deepEqual(list.items, [{ name: 'Flaked almonds', amount: 4 }, { name: 'Pearl sugar', amount: 4 }, { name: 'Egg', amount: 1 }]);
  assert.equal(parseItemList('Olives=36|Oregano').errors.length, 1);
});

test("owner's four CSV files plan without errors", { skip: !existsSync(join(DIR, 'ingredients.csv')) && 'stock-tracking folder not present' }, () => {
  const files = {
    ingredients: readFileSync(join(DIR, 'ingredients.csv'), 'utf8'),
    recipes: readFileSync(join(DIR, 'recipes.csv'), 'utf8'),
    products: readFileSync(join(DIR, 'products.csv'), 'utf8'),
    recipe_lines: readFileSync(join(DIR, 'recipe_lines.csv'), 'utf8'),
  };
  const plan = planImport(files, SHOP);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.unknown_items, []);
  assert.equal(plan.ingredients.length, 41);
  assert.equal(plan.recipes.length, 17);
  assert.equal(plan.products.length, 16);
  assert.equal(plan.starters.length, 2);

  const egg = plan.ingredients.find((i) => i.name === 'Egg')!;
  assert.equal(egg.unit, 'pcs');
  const yolk = plan.ingredients.find((i) => i.name === 'Egg yolk')!;
  assert.equal(yolk.derived_from_name, 'Egg'); assert.equal(yolk.g_per_source_unit, 17);
  const extract = plan.ingredients.find((i) => i.name === 'Almond extract')!;
  assert.deepEqual(extract.allergens, []); assert.equal(extract.components_de, null);
  const sesame = plan.ingredients.find((i) => i.name === 'Sesame black')!;
  assert.deepEqual(sesame.allergens, ['Sesamsamen']);
  const roasted = plan.ingredients.find((i) => i.name === 'Roasted sourdough')!;
  assert.deepEqual(roasted.allergens, ['Weizen', 'Roggen']);
  assert.equal(roasted.components_de, '**Weizen**mehl, **Roggen**mehl');

  const stockdorf = plan.recipes.find((r) => r.name === 'Stockdorf Sourdough')!;
  assert.equal(stockdorf.dough_margin_factor, 0.05);
  assert.equal(stockdorf.max_batch_g, 4500);
  assert.ok(Math.abs(stockdorf.sum_pct - 219.85) < 1e-9);
  const brioche = plan.recipes.find((r) => r.name === 'Brioche')!;
  assert.equal(brioche.dough_margin_factor, 0.05);
  assert.deepEqual(brioche.per_batch_items, [{ name: 'Egg', amount: 1 }]);
  const vd = plan.recipes.find((r) => r.name === 'Rye & Wheat voordeeg')!;
  assert.equal(vd.kind, 'sub'); assert.equal(vd.build_margin_pct, 3); assert.equal(vd.dough_margin_factor, null);
  const pizza = plan.recipes.find((r) => r.name === 'Pizza dough')!;
  assert.equal(pizza.dough_margin_factor, null); // → settings default

  const llw = plan.starters.find((s) => s.name === 'LL Wheat')!;
  assert.equal(llw.maintenance_flour_name, 'Wheat flour T80/1050');
  assert.equal(llw.stiff_last_stage, true);
  assert.deepEqual(llw.stages.map((s) => [s.flour_parts, s.water_parts, s.seed_parts]), [[2, 1, 1], [2, 2, 1], [2, 2, 1]]);
  assert.equal(llw.stages[0].flour_from_recipe, true);
  const llr = plan.starters.find((s) => s.name === 'LL Rye')!;
  assert.equal(llr.maintenance_flour_name, 'Rye flour T130/1150');
  assert.deepEqual(llr.stages.map((s) => [s.flour_parts, s.water_parts, s.seed_parts]), [[2, 2, 1], [2, 2, 1], [2, 2, 1]]);
  assert.equal(llr.stages[0].flour_from_recipe, false);

  const linked = plan.products.filter((p) => p.link_status === 'linked').map((p) => p.name).sort();
  assert.deepEqual(linked, ['Amaretti Cacao & Caffè', 'Amaretti Classici', 'Baguette', 'Brioche', 'Ciabatta Naturale', 'Ciabatta Olive & Origano', 'Focaccia Naturale', 'Focaccia Pomodorini', 'Rye & Wheat', 'Spelt Sourdough', 'Stockdorf Sourdough']);
  const pending = plan.products.filter((p) => p.link_status === 'pending').map((p) => p.name);
  assert.deepEqual(pending, ['Amaretti Citrus']);
  const intern = plan.products.filter((p) => p.link_status === 'internal').map((p) => p.name).sort();
  assert.deepEqual(intern, ['Baby-Brioche Lumbono', 'Focaccia Lumbono', 'Frühstückssemmeln', 'Pizza dough']);
  const amaretti = plan.products.find((p) => p.name === 'Amaretti Classici')!;
  assert.equal(amaretti.production, 'stock'); assert.equal(amaretti.pieces_per_unit, 5);
  assert.deepEqual(amaretti.extras, [{ name: 'Sugar', amount: 0.5 }, { name: 'Powdered sugar', amount: 0.5 }]);
  const baby = plan.products.find((p) => p.name === 'Baby-Brioche Lumbono')!;
  assert.equal(baby.dough_per_unit_g, 50); assert.equal(baby.production, 'stock');

  // warnings are informative only: pending link + nothing else unexpected
  assert.ok(plan.warnings.some((w) => w.includes('Amaretti Citrus')));
  assert.ok(!plan.warnings.some((w) => w.includes('ignored for sub-recipes')), plan.warnings.join('\n'));
});

test('unknown ingredient, bad kind and a sub margin are reported, never guessed', () => {
  const plan = planImport({
    ingredients: 'item,name_de,allergens,components_de,unit\nFlour,Mehl,Weizen,,g\n',
    recipes: 'recipe,kind,dough_margin_factor,build_margin_pct,max_batch_g,per_batch_items\nA,dough,,,,\nB,sub,0.05,2,,\nC,pasta,,,,\n',
    products: 'product,recipe,channel,dough_per_unit_g,bake_loss_pct,extras,production\nA,A,web,100,,,orders\n',
    recipe_lines: 'recipe,position,type,item,pct,final_flour,label\nA,1,ingredient,Flour,100,,\nA,2,ingredient,Salt,2,,\nB,1,ingredient,Flour,100,,\n',
  }, [{ id: 'x', name: 'A' }]);
  assert.deepEqual(plan.unknown_items, ['Salt']);
  assert.ok(plan.errors.some((e) => e.includes('Unknown ingredient "Salt"')));
  assert.ok(plan.errors.some((e) => e.includes('"C": kind must be')));
  assert.ok(plan.warnings.some((e) => e.includes('"B": dough_margin_factor is ignored')));
});
