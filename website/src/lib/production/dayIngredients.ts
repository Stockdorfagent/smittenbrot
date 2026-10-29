/**
 * "What do I need today?" — every ingredient of a bake sheet summed up, pure
 * (owner, 27.10.2026: a plain list, so a supermarket run can be decided at a
 * glance; the former "Whole eggs needed today" line generalised).
 *
 * Counted:   recipe lines and pre-dough lines (× batches), per-batch items,
 *            per-piece extras (deco/topping) of the products baked today,
 *            and of the sourdough ONLY the flour and water of the final build
 *            that goes into the dough — not the seed, not earlier feedings.
 * Eggs:      derived ingredients (egg white / yolk) are bought as whole eggs,
 *            so they appear as "Egg … pcs" (per-line rounded, like the baker
 *            separates them per recipe) instead of grams of white or yolk.
 * Not counted: stock products delivered from the freezer (made earlier).
 */
import type { BakeSheet, GramLine, SubBlock, Unit } from './types';

export interface IngredientTotal { key: string; name: string; unit: Unit; amount: number }

export function dayIngredientTotals(sheet: BakeSheet): IngredientTotal[] {
  // Keyed by NAME (ingredient names are unique): a whole-egg line of one recipe
  // and the eggs behind another recipe's yolk line must land on the same row,
  // and the starter's water joins the dough's water.
  const totals = new Map<string, IngredientTotal>();
  const add = (name: string, unit: Unit, amount: number) => {
    if (!(amount > 0)) return;
    const key = `${name.trim().toLowerCase()}|${unit}`;
    const row = totals.get(key) ?? { key, name: name.trim(), unit, amount: 0 };
    row.amount += amount;
    totals.set(key, row);
  };
  const addLines = (lines: GramLine[], mult: number) => {
    for (const l of lines) {
      if (l.source_units_rounded && l.source_name) {
        add(l.source_name, 'pcs', l.source_units_rounded * mult);
        continue;                                     // the white/yolk grams come from those eggs
      }
      add(l.ingredient_name, l.unit, l.grams * mult);
    }
  };
  const addSub = (b: SubBlock, mult: number) => {
    addLines(b.lines, mult);
    b.subs.forEach((c) => addSub(c, mult));
    // starters inside subs are already in the recipe block's `starters` list
  };
  for (const r of sheet.recipes) {
    const mult = r.batches;
    addLines(r.lines, mult);
    r.subs.forEach((b) => addSub(b, mult));
    for (const s of r.starters) {
      add(s.flour_ingredient_name, 'g', s.flour_g * mult);
      add('Water', 'g', s.water_g * mult);
    }
    for (const p of r.per_batch_items) add(p.ingredient_name, p.unit, p.amount * mult);
    for (const e of r.extras) for (const l of e.lines) add(l.ingredient_name, l.unit, l.total);
  }
  return Array.from(totals.values()).sort((a, b) => (a.unit === b.unit ? b.amount - a.amount : a.unit === 'g' ? -1 : 1));
}

/** 5500 g → "5,50 kg", 12345 g → "12,3 kg", 36.4 g → "36 g", 12 pcs → "12 pcs" (German format, fixed decimals). */
export function fmtAmount(t: { unit: Unit; amount: number }): string {
  if (t.unit === 'pcs') return `${Math.ceil(t.amount - 1e-9)} pcs`;
  if (t.amount >= 1000) {
    const kg = t.amount / 1000;
    const d = kg >= 10 ? 1 : 2;
    return `${kg.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} kg`;
  }
  return `${Math.round(t.amount).toLocaleString('de-DE')} g`;
}
