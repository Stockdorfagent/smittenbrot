/** Step 1b acceptance tests (SPEC §1b.4) with the owner's name_de wording from ingredients.csv. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIngredientList, mergeAllergens, markersToCaps, diffLists } from './ingredientList.ts';
import type { Ingredient, ProductionData, Recipe, RecipeItem, Starter, ProductLink } from './types.ts';

const ING: Ingredient[] = [];
function ing(name: string, name_de: string | null, allergens: string[] | null, components_de: string | null = null, unit: 'g' | 'pcs' = 'g'): Ingredient {
  const i: Ingredient = { id: `ing-${name}`, name, unit, name_de, allergens, components_de, derived_from: null, g_per_source_unit: null, notes: null };
  ING.push(i); return i;
}
ing('Wheat flour T80/1050', '**Weizen**mehl', ['Weizen']);
ing('Wheat flour T55/550', '**Weizen**mehl', ['Weizen']);
ing('Spelt flour T65/630', '**Dinkel**mehl', ['Weizen (Dinkel)']);
ing('Water', 'Wasser', []);
ing('Salt', 'Salz', []);
ing('Acerola powder', 'Acerolakirschpulver', [], 'Acerolakirschpulver, Trägerstoff: Maltodextrin');
ing('Yeast', 'Hefe', []);
ing('Vanilla', 'Vanille', []); ing('Lemon', 'Zitronenschale', []); ing('Rum', 'Rum', []);
ing('Egg yolk', '**Eigelb**', ['Eier']); ing('Milk', '**Milch**', ['Milch']); ing('Butter', '**Butter**', ['Milch']); ing('Sugar', 'Zucker', []);
ing('Flaked almonds', '**Mandeln** gehobelt', ['Schalenfrüchte (Mandeln)']); ing('Pearl sugar', 'Hagelzucker', []); ing('Egg', '**Ei**', ['Eier'], null, 'pcs');
ing('Olive oil', 'Olivenöl', []); ing('Olives', 'Oliven', [], 'Oliven, Wasser, Salz, Stabilisator (Eisen-II-gluconat)'); ing('Oregano', 'Oregano', []);
ing('Almond extract', 'Bittermandelextrakt', null); ing('Almond flour', '**Mandelmehl**', ['Schalenfrüchte (Mandeln)']); ing('Egg white', '**Eiweiß**', ['Eier']);

const LL_WHEAT: Starter = { id: 'st-wheat', name: 'LL Wheat', maintenance_flour_ingredient_id: 'ing-Wheat flour T80/1050', stages: [
  { stage_no: 1, day_offset: -1, flour_parts: 2, water_parts: 1, seed_parts: 1, flour_from_recipe: true },
  { stage_no: 2, day_offset: -2, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
] };
let pos = 0;
function line(type: RecipeItem['type'], item: string, pct: number, label: string | null = null, finalFlour: string | null = null): RecipeItem {
  pos++;
  return { id: `it-${pos}`, position: pos, type, ingredient_id: type === 'ingredient' ? `ing-${item}` : null, sub_recipe_id: type === 'sub' ? `rec-${item}` : null, starter_id: type === 'starter' ? 'st-wheat' : null, final_flour_ingredient_id: finalFlour ? `ing-${finalFlour}` : null, pct, label };
}
function recipe(name: string, kind: 'dough' | 'sub', items: RecipeItem[]): Recipe {
  return { id: `rec-${name}`, name, kind, base_ingredient_id: null, dough_margin_factor: 0.05, build_margin_pct: null, max_batch_g: null, per_batch_items: [], current_version: 1, notes: null, items };
}
const STOCKDORF = recipe('Stockdorf', 'dough', [line('ingredient', 'Wheat flour T80/1050', 100), line('ingredient', 'Acerola powder', 0.05), line('ingredient', 'Salt', 2.3), line('starter', 'LL Wheat', 40, 'stiff levain', 'Wheat flour T80/1050'), line('ingredient', 'Water', 75), line('ingredient', 'Water', 2.5, 'bassinage')]);
const BRIOCHE = recipe('Brioche', 'dough', [line('ingredient', 'Wheat flour T55/550', 95), line('ingredient', 'Spelt flour T65/630', 5), line('ingredient', 'Salt', 2), line('ingredient', 'Yeast', 3), line('ingredient', 'Vanilla', 0.5), line('ingredient', 'Lemon', 0.5), line('starter', 'LL Wheat', 6, 'stiff levain', 'Wheat flour T80/1050'), line('ingredient', 'Egg yolk', 13), line('ingredient', 'Rum', 1), line('ingredient', 'Milk', 43), line('ingredient', 'Butter', 21), line('ingredient', 'Sugar', 11)]);
const CIABATTA = recipe('Ciabatta', 'dough', [line('ingredient', 'Wheat flour T55/550', 100), line('ingredient', 'Acerola powder', 0.05), line('ingredient', 'Salt', 2.2), line('ingredient', 'Yeast', 0.5), line('starter', 'LL Wheat', 30, 'stiff levain', 'Wheat flour T80/1050'), line('ingredient', 'Water', 65), line('ingredient', 'Water', 10, 'bassinage'), line('ingredient', 'Olive oil', 2)]);
const AMARETTI = recipe('Amaretti Classici', 'dough', [line('ingredient', 'Egg white', 100), line('ingredient', 'Almond flour', 286), line('ingredient', 'Sugar', 257), line('ingredient', 'Almond extract', 7)]);

function product(name: string, recipeId: string, dough: number, extras: { ingredient_id: string; grams: number }[] = []): ProductLink {
  return { id: `pp-${name}`, product_id: `shop-${name}`, name, channel: 'web', recipe_id: recipeId, dough_per_unit_g: dough, bake_loss_pct: null, extras, production: 'orders', pieces_per_unit: null, link_status: 'linked' };
}
const DATA: ProductionData = { ingredients: ING, starters: [LL_WHEAT], recipes: [STOCKDORF, BRIOCHE, CIABATTA, AMARETTI], products: [], settings: { dough_margin_factor: 0.1, build_margin_pct: 10, final_build_margin_pct: 10 } };

test('Stockdorf → Weizenmehl, Wasser, Salz, Acerolakirschpulver (compound in brackets); allergens Weizen', () => {
  const g = generateIngredientList(product('Stockdorf Sourdough', 'rec-Stockdorf', 850), DATA);
  assert.deepEqual(g.blocked, []);
  assert.equal(g.text, '**Weizen**mehl, Wasser, Salz, Acerolakirschpulver (Acerolakirschpulver, Trägerstoff: Maltodextrin)');
  assert.equal(g.legacy, 'WEIZENmehl, Wasser, Salz, Acerolakirschpulver (Acerolakirschpulver, Trägerstoff: Maltodextrin)');
  assert.deepEqual(g.allergens, ['Weizen']);
  // starter flour + water folded into the matching ingredients, never "Sauerteig"
  const flour = g.entries.find((e) => e.name_de === '**Weizen**mehl')!, water = g.entries.find((e) => e.name_de === 'Wasser')!;
  const f = 850 / 219.85;
  assert.ok(Math.abs(flour.grams - (100 + 40 * 0.625) * f) < 1e-9);
  assert.ok(Math.abs(water.grams - (77.5 + 40 * 0.375) * f) < 1e-9);
});

test('Brioche: starter water appears after the yeast (~2 % of flour); egg yolk as name_de; wheat+spelt → Weizen (inkl. Dinkel)', () => {
  const g = generateIngredientList(product('Brioche', 'rec-Brioche', 265, [{ ingredient_id: 'ing-Flaked almonds', grams: 4 }, { ingredient_id: 'ing-Pearl sugar', grams: 4 }, { ingredient_id: 'ing-Egg', grams: 1 }]), DATA);
  assert.deepEqual(g.blocked, []);
  const names = g.entries.map((e) => e.name_de);
  assert.ok(names.indexOf('Wasser') > names.indexOf('Hefe'), names.join(' > '));
  assert.ok(names.includes('**Eigelb**'));
  assert.ok(names.indexOf('**Ei**') > names.indexOf('Rum'));          // 1 g egg wash sorts near the end
  assert.deepEqual(g.allergens, ['Weizen (inkl. Dinkel)', 'Milch', 'Eier', 'Schalenfrüchte (Mandeln)']);
  assert.ok(g.text.startsWith('**Weizen**mehl, **Milch**, **Butter**'));
});

test('Ciabatta Olive & Origano: olives listed once with their components', () => {
  const g = generateIngredientList(product('Ciabatta Olive & Origano', 'rec-Ciabatta', 355, [{ ingredient_id: 'ing-Olives', grams: 36 }, { ingredient_id: 'ing-Oregano', grams: 0.4 }]), DATA);
  assert.equal((g.text.match(/Oliven(?![a-zäöüß])/g) ?? []).length, 2); // once as the name, once inside its own components (Olivenöl excluded)
  assert.equal(g.entries.filter((e) => e.name_de === 'Oliven').length, 1);
  assert.ok(g.text.includes('Oliven (Oliven, Wasser, Salz, Stabilisator (Eisen-II-gluconat))'));
});

test('generation is blocked while an allergen field is unchecked', () => {
  const g = generateIngredientList(product('Amaretti Classici', 'rec-Amaretti Classici', 50), DATA);
  assert.equal(g.ok, false);
  assert.ok(g.blocked.some((b) => b.includes('Almond extract') && b.includes('not checked')));
  assert.equal(generateIngredientList({ ...product('X', 'rec-Stockdorf', 100), recipe_id: null }, DATA).blocked[0], 'No recipe linked.');
});

test('allergen merging and markers', () => {
  assert.deepEqual(mergeAllergens(['Weizen', 'Weizen', 'Roggen']), ['Weizen', 'Roggen']);
  assert.deepEqual(mergeAllergens(['Weizen (Dinkel)']), ['Weizen (Dinkel)']);
  assert.deepEqual(mergeAllergens(['Schalenfrüchte (Mandeln)', 'Schalenfrüchte (Haselnüsse)', 'Milch']), ['Schalenfrüchte (Mandeln, Haselnüsse)', 'Milch']);
  assert.equal(markersToCaps('**Weizen**mehl, **Ei**, Salz'), 'WEIZENmehl, EI, Salz');
  const d = diffLists('Weizenmehl, Wasser, Salz, Oliven, Oliven', '**Weizen**mehl, Wasser, Salz, Oliven (Oliven, Wasser)');
  assert.deepEqual(d.added, ['Oliven (Oliven, Wasser)']); assert.deepEqual(d.removed, ['Oliven', 'Oliven']); assert.equal(d.same, false);
});
