/**
 * Step 1b — customer-facing ingredient and allergen lists generated from the
 * recipes (SPEC §1b), pure.
 *
 * One piece of the product is expanded without any margin: dough lines, sub-
 * recipes, starters (last refresh flour + water, plus the seed assumed at
 * 100 % hydration on the maintenance flour) and the per-piece extras. Weights
 * are grouped by `name_de`, summed and sorted descending (LMIV Art. 18(1):
 * descending order of weight at the time of use). Starters are never listed
 * as "Sauerteig". Bake loss is ignored.
 *
 * Output: `text` with `**…**` markers (website renders bold), `legacy` with the
 * marked part in CAPITALS (app 1.0.7 shows it without a build), `allergens`
 * deduplicated by Annex II category with the owner's wheat/spelt wording.
 */
import type { Ingredient, ProductLink, ProductionData, Recipe, Starter } from './types';

export interface GeneratedList {
  ok: boolean;
  blocked: string[];                 // reasons generation is blocked (no name_de / allergens unchecked / no recipe)
  entries: { name_de: string; components_de: string | null; grams: number; allergens: string[] }[];
  text: string;                      // "**Weizen**mehl, Wasser, Salz, Acerolakirschpulver (…)"
  legacy: string;                    // "WEIZENmehl, Wasser, Salz, …"
  allergens: string[];               // ["Weizen", "Milch", …]
  allergens_text: string;            // "Weizen, Milch"
}

/** `**Weizen**mehl` → `WEIZENmehl` */
export function markersToCaps(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, (_, m: string) => m.toUpperCase());
}
export function stripMarkers(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1');
}

interface Acc { grams: Map<string, number>; meta: Map<string, { components_de: string | null; allergens: string[] }>; blocked: Set<string> }

function add(acc: Acc, ing: Ingredient, grams: number) {
  if (grams <= 0) return;
  if (!ing.name_de) { acc.blocked.add(`${ing.name}: no German name (name_de).`); return; }
  if (ing.allergens === null) acc.blocked.add(`${ing.name}: allergens not checked yet.`);
  const key = ing.name_de;
  acc.grams.set(key, (acc.grams.get(key) ?? 0) + grams);
  const m = acc.meta.get(key) ?? { components_de: ing.components_de, allergens: [] };
  for (const a of ing.allergens ?? []) if (!m.allergens.includes(a)) m.allergens.push(a);
  if (!m.components_de && ing.components_de) m.components_de = ing.components_de;
  acc.meta.set(key, m);
}

function sumPct(r: Recipe): number { return r.items.reduce((s, it) => s + Number(it.pct), 0); }

function expandRecipe(acc: Acc, recipe: Recipe, totalG: number, data: ProductionData, ingredients: Map<string, Ingredient>, starters: Map<string, Starter>, trail: string[]) {
  const sum = sumPct(recipe);
  if (sum <= 0) return;
  const factor = totalG / sum;
  for (const it of recipe.items) {
    const g = Number(it.pct) * factor;
    if (it.type === 'ingredient' && it.ingredient_id) {
      const ing = ingredients.get(it.ingredient_id);
      if (ing) add(acc, ing, g); else acc.blocked.add(`${recipe.name}: unknown ingredient on a line.`);
    } else if (it.type === 'sub' && it.sub_recipe_id) {
      const sub = data.recipes.find((r) => r.id === it.sub_recipe_id);
      if (!sub || trail.includes(sub.id)) { acc.blocked.add(`${recipe.name}: sub-recipe missing or circular.`); continue; }
      expandRecipe(acc, sub, g, data, ingredients, starters, [...trail, sub.id]);
    } else if (it.type === 'starter' && it.starter_id) {
      const st = starters.get(it.starter_id);
      if (!st) { acc.blocked.add(`${recipe.name}: unknown starter.`); continue; }
      const s1 = [...st.stages].sort((a, b) => a.stage_no - b.stage_no)[0];
      const parts = s1 ? Number(s1.flour_parts) + Number(s1.water_parts) + Number(s1.seed_parts) : 0;
      const maint = st.maintenance_flour_ingredient_id ? ingredients.get(st.maintenance_flour_ingredient_id) : undefined;
      const finalFlour = (s1?.flour_from_recipe && it.final_flour_ingredient_id ? ingredients.get(it.final_flour_ingredient_id) : undefined) ?? maint;
      const water = data.ingredients.find((i) => i.name.toLowerCase() === 'water' || i.name_de?.toLowerCase() === 'wasser');
      if (!parts || !finalFlour || !maint || !water) { acc.blocked.add(`${st.name}: starter needs a last stage, a maintenance flour and a "Water" ingredient.`); continue; }
      const flourG = g * Number(s1.flour_parts) / parts;
      const waterG = g * Number(s1.water_parts) / parts;
      const seedG = g * Number(s1.seed_parts) / parts;          // LL seed: 100 % hydration on the maintenance flour
      add(acc, finalFlour, flourG);
      add(acc, water, waterG + seedG / 2);
      add(acc, maint, seedG / 2);
    }
  }
}

/** Dedupe allergens by Annex II category; wheat/spelt wording per the owner (18.10.2026). */
export function mergeAllergens(raw: string[]): string[] {
  const byCat = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const a of raw) {
    const s = a.trim();
    if (!s) continue;
    const cat = s.replace(/\s*\(.*\)\s*$/, '').trim();
    if (!byCat.has(cat)) { byCat.set(cat, new Set()); order.push(cat); }
    byCat.get(cat)!.add(s);
  }
  const out: string[] = [];
  for (const cat of order) {
    const variants = [...byCat.get(cat)!];
    if (cat === 'Weizen') {
      const plain = variants.includes('Weizen');
      const spelt = variants.some((v) => /dinkel/i.test(v));
      out.push(plain && spelt ? 'Weizen (inkl. Dinkel)' : spelt ? 'Weizen (Dinkel)' : 'Weizen');
      continue;
    }
    const withDetail = variants.filter((v) => v !== cat);
    if (withDetail.length === 0) { out.push(cat); continue; }
    // keep the detail, merged: "Schalenfrüchte (Mandeln)" + "Schalenfrüchte (Haselnüsse)" → "Schalenfrüchte (Mandeln, Haselnüsse)"
    const details = withDetail.flatMap((v) => (v.match(/\((.*)\)/)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    out.push(`${cat} (${[...new Set(details)].join(', ')})`);
  }
  return out;
}

export function generateIngredientList(product: ProductLink, data: ProductionData): GeneratedList {
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const starters = new Map(data.starters.map((s) => [s.id, s]));
  const acc: Acc = { grams: new Map(), meta: new Map(), blocked: new Set() };
  const recipe = product.recipe_id ? data.recipes.find((r) => r.id === product.recipe_id) : undefined;
  if (!recipe) acc.blocked.add('No recipe linked.');
  else expandRecipe(acc, recipe, Number(product.dough_per_unit_g), data, ingredients, starters, [recipe.id]);
  for (const e of product.extras ?? []) {
    const ing = ingredients.get(e.ingredient_id);
    if (ing) add(acc, ing, Number(e.grams)); else acc.blocked.add('Unknown ingredient in the extras.');
  }
  const entries = [...acc.grams.entries()]
    .map(([name_de, grams]) => ({ name_de, grams, components_de: acc.meta.get(name_de)?.components_de ?? null, allergens: acc.meta.get(name_de)?.allergens ?? [] }))
    .sort((a, b) => b.grams - a.grams || a.name_de.localeCompare(b.name_de));
  const text = entries.map((e) => e.components_de ? `${e.name_de} (${e.components_de})` : e.name_de).join(', ');
  const allergens = mergeAllergens(entries.flatMap((e) => e.allergens));
  const blocked = [...acc.blocked];
  return {
    ok: blocked.length === 0 && entries.length > 0,
    blocked,
    entries,
    text,
    legacy: markersToCaps(text),
    allergens,
    allergens_text: allergens.join(', '),
  };
}

/** Item-level diff of two comma-separated lists (for the approval preview). */
export function splitList(text: string | null): string[] {
  const out: string[] = []; let cur = ''; let depth = 0;
  for (const c of text ?? '') {
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => stripMarkers(x).trim()).filter(Boolean);
}

export function diffLists(oldText: string | null, newText: string): { removed: string[]; added: string[]; same: boolean } {
  const split = splitList;
  const a = split(oldText), b = split(newText);
  return { removed: a.filter((x) => !b.includes(x)), added: b.filter((x) => !a.includes(x)), same: a.join('|') === b.join('|') };
}
