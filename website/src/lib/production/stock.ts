/**
 * Steps 3 + 4 (owner, 29.10.2026) — pure calculations on top of the ledger and
 * the confirmed deliveries. No I/O here; data.ts loads, the API routes write.
 *
 * Stock:   level = Σ ledger. Best-before = the earliest date among the newest
 *          confirmed lines that together cover the current level (FIFO view).
 * Prices:  the newest confirmed line of an ingredient is its price. Two numbers,
 *          kept apart on purpose: goods price per unit and the delivery share per
 *          unit (that delivery's fee spread evenly over its lines).
 * Costs:   cost per unit sold = the recipe expanded for one unit (dough_per_unit_g,
 *          sub-recipes with their build margin, starters' final build incl. its
 *          margin, derived ingredients charged as their source, extras once) ×
 *          price. Dough margin and per-batch items are not included.
 * Consumption: what a frozen bake sheet used, by ingredient id, for the ledger.
 */
import type { BakeSheet, Delivery, DeliveryLine, GramLine, Ingredient, LedgerRow, ProductLink, ProductionData, Recipe, Starter, SubBlock } from './types';

export interface IngredientPrice {
  ingredient_id: string;
  unit_price: number;           // cents per g (or per pc)
  delivery_share: number;       // cents per g (or per pc)
  date: string;
  supplier_id: string | null;
  pack_amount: number;
  price_cents: number;
  previous_unit_price: number | null;   // the line before (goods price only), for the trend
}

/** Confirmed lines newest first, with their delivery's fee share. */
function confirmedLines(deliveries: Delivery[]): (DeliveryLine & { date: string; supplier_id: string | null; fee_share_cents: number; delivery_id: string })[] {
  const out: (DeliveryLine & { date: string; supplier_id: string | null; fee_share_cents: number; delivery_id: string })[] = [];
  for (const d of deliveries) {
    if (d.status !== 'confirmed') continue;
    const n = d.lines.filter((l) => l.ingredient_id).length || 1;
    for (const l of d.lines) if (l.ingredient_id && l.amount > 0) out.push({ ...l, date: d.date, supplier_id: d.supplier_id, fee_share_cents: d.delivery_fee_cents / n, delivery_id: d.id });
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export function ingredientPrices(deliveries: Delivery[]): Map<string, IngredientPrice> {
  const out = new Map<string, IngredientPrice>();
  for (const l of confirmedLines(deliveries)) {
    const id = l.ingredient_id!;
    const cur = out.get(id);
    if (!cur) {
      out.set(id, { ingredient_id: id, unit_price: l.price_cents / l.amount, delivery_share: l.fee_share_cents / l.amount, date: l.date, supplier_id: l.supplier_id, pack_amount: l.pack_amount, price_cents: l.price_cents, previous_unit_price: null });
    } else if (cur.previous_unit_price === null) {
      cur.previous_unit_price = l.price_cents / l.amount;
    }
  }
  return out;
}

export function stockLevels(ledger: LedgerRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ledger) out.set(r.ingredient_id, (out.get(r.ingredient_id) ?? 0) + Number(r.amount));
  return out;
}

/** Earliest best-before among the newest confirmed lines that cover `level` (FIFO: older packs are used first). */
export function earliestBbf(ingredientId: string, level: number, deliveries: Delivery[]): string | null {
  if (!(level > 0)) return null;
  let covered = 0; let earliest: string | null = null;
  for (const l of confirmedLines(deliveries)) {
    if (l.ingredient_id !== ingredientId) continue;
    if (l.bbf && (!earliest || l.bbf < earliest)) earliest = l.bbf;
    covered += l.amount;
    if (covered >= level) break;
  }
  return earliest;
}

export interface StockRow {
  ingredient_id: string; name: string; unit: Ingredient['unit'];
  level: number; reorder_level: number | null; low: boolean;
  bbf: string | null; bbf_days: number | null;
  price: IngredientPrice | null;
}

export function stockRows(data: ProductionData, ledger: LedgerRow[], deliveries: Delivery[], today: string): StockRow[] {
  const levels = stockLevels(ledger);
  const prices = ingredientPrices(deliveries);
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return data.ingredients.filter((i) => i.track_stock && !i.derived_from).map((i) => {
    const level = levels.get(i.id) ?? 0;
    const bbf = i.track_bbf ? earliestBbf(i.id, level, deliveries) : null;
    const bbfDays = bbf ? Math.round((Date.UTC(+bbf.slice(0, 4), +bbf.slice(5, 7) - 1, +bbf.slice(8, 10)) - t) / 86400000) : null;
    return { ingredient_id: i.id, name: i.name, unit: i.unit, level, reorder_level: i.reorder_level, low: i.reorder_level !== null && level < i.reorder_level, bbf, bbf_days: bbfDays, price: prices.get(i.id) ?? null };
  });
}

// ---------- cost per unit sold ----------

export interface CostLine { ingredient_id: string; name: string; unit: Ingredient['unit']; amount: number; goods_cents: number | null; delivery_cents: number | null }
export interface ProductCost {
  pr_product_id: string; name: string; channel: ProductLink['channel'];
  lines: CostLine[];
  goods_cents: number; delivery_cents: number; total_cents: number;
  missing: string[];            // ingredient names without a price
  blocked: string | null;       // no recipe / raw mass not set
}

/** Grams (or pcs) of every ingredient for ONE unit sold, keyed by ingredient id; derived ingredients charged as their source. */
export function perUnitAmounts(product: ProductLink, data: ProductionData): { amounts: Map<string, number>; blocked: string | null } {
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const starters = new Map(data.starters.map((s) => [s.id, s]));
  const amounts = new Map<string, number>();
  const problems: string[] = [];
  const add = (ing: Ingredient | undefined, g: number) => {
    if (!ing || !(g > 0)) return;
    if (ing.derived_from && ing.g_per_source_unit) { add(ingredients.get(ing.derived_from), g / ing.g_per_source_unit); return; }
    amounts.set(ing.id, (amounts.get(ing.id) ?? 0) + g);
  };
  const expand = (recipe: Recipe, totalG: number, trail: string[]) => {
    const sum = recipe.items.reduce((s, it) => s + Number(it.pct), 0);
    if (sum <= 0) return;
    const factor = totalG / sum;
    for (const it of recipe.items) {
      const g = Number(it.pct) * factor;
      if (it.type === 'ingredient' && it.ingredient_id) add(ingredients.get(it.ingredient_id), g);
      else if (it.type === 'sub' && it.sub_recipe_id) {
        const sub = data.recipes.find((r) => r.id === it.sub_recipe_id);
        if (!sub || trail.includes(sub.id)) { problems.push(`${recipe.name}: sub-recipe missing or circular`); continue; }
        const margin = sub.build_margin_pct ?? data.settings.build_margin_pct;
        expand(sub, g * (1 + margin / 100), [...trail, sub.id]);
      } else if (it.type === 'starter' && it.starter_id) {
        const st: Starter | undefined = starters.get(it.starter_id);
        const s1 = st ? [...st.stages].sort((a, b) => a.stage_no - b.stage_no)[0] : undefined;
        const parts = s1 ? s1.flour_parts + s1.water_parts + s1.seed_parts : 0;
        const maint = st?.maintenance_flour_ingredient_id ? ingredients.get(st.maintenance_flour_ingredient_id) : undefined;
        const finalFlour = (s1?.flour_from_recipe && it.final_flour_ingredient_id ? ingredients.get(it.final_flour_ingredient_id) : undefined) ?? maint;
        const water = data.ingredients.find((i) => i.name.toLowerCase() === 'water' || i.name_de?.toLowerCase() === 'wasser');
        if (!st || !s1 || !parts || !finalFlour || !maint) { problems.push(`${recipe.name}: starter incomplete`); continue; }
        const build = g * (1 + data.settings.final_build_margin_pct / 100);
        add(finalFlour, build * s1.flour_parts / parts);
        add(water, build * s1.water_parts / parts + build * s1.seed_parts / parts / 2);
        add(maint, build * s1.seed_parts / parts / 2);
      }
    }
  };
  const recipe = product.recipe_id ? data.recipes.find((r) => r.id === product.recipe_id) : undefined;
  if (!recipe) return { amounts, blocked: 'no recipe' };
  if (!(product.dough_per_unit_g > 0)) return { amounts, blocked: 'raw mass not set' };
  expand(recipe, product.dough_per_unit_g, [recipe.id]);
  for (const e of product.extras ?? []) add(ingredients.get(e.ingredient_id), e.grams);
  return { amounts, blocked: problems[0] ?? null };
}

export function productCost(product: ProductLink, data: ProductionData, prices: Map<string, IngredientPrice>): ProductCost {
  const byId = new Map(data.ingredients.map((i) => [i.id, i]));
  const { amounts, blocked } = perUnitAmounts(product, data);
  const lines: CostLine[] = [];
  const missing: string[] = [];
  let goods = 0, delivery = 0;
  for (const [id, amount] of amounts) {
    const ing = byId.get(id); if (!ing) continue;
    if (ing.name.toLowerCase() === 'water' || ing.name_de?.toLowerCase() === 'wasser') continue;   // tap water: no price, never "missing"
    const p = prices.get(id);
    if (!p) { missing.push(ing.name); lines.push({ ingredient_id: id, name: ing.name, unit: ing.unit, amount, goods_cents: null, delivery_cents: null }); continue; }
    const g = amount * p.unit_price, d = amount * p.delivery_share;
    goods += g; delivery += d;
    lines.push({ ingredient_id: id, name: ing.name, unit: ing.unit, amount, goods_cents: g, delivery_cents: d });
  }
  lines.sort((a, b) => (b.goods_cents ?? 0) - (a.goods_cents ?? 0) || a.name.localeCompare(b.name));
  return { pr_product_id: product.id, name: product.name, channel: product.channel, lines, goods_cents: goods, delivery_cents: delivery, total_cents: goods + delivery, missing, blocked };
}

// ---------- consumption of a bake day ----------

/** Amounts a (frozen) bake sheet used, by ingredient id: derived lines as whole source units, starters' final build flour + water, extras, per-batch items. */
export function dayConsumption(sheet: BakeSheet, data: ProductionData): Map<string, number> {
  const byName = new Map(data.ingredients.map((i) => [i.name.toLowerCase(), i.id]));
  const byId = new Map(data.ingredients.map((i) => [i.id, i]));
  const water = data.ingredients.find((i) => i.name.toLowerCase() === 'water' || i.name_de?.toLowerCase() === 'wasser')?.id ?? null;
  const out = new Map<string, number>();
  const add = (id: string | null, amount: number) => { if (id && amount > 0) out.set(id, (out.get(id) ?? 0) + amount); };
  const addLines = (lines: GramLine[], mult: number) => {
    for (const l of lines) {
      if (l.source_units_rounded && l.source_name) {
        const ing = l.ingredient_id ? byId.get(l.ingredient_id) : undefined;
        add(ing?.derived_from ?? byName.get(l.source_name.toLowerCase()) ?? null, l.source_units_rounded * mult);
        continue;
      }
      add(l.ingredient_id, l.grams * mult);
    }
  };
  const addSub = (b: SubBlock, mult: number) => { addLines(b.lines, mult); b.subs.forEach((c) => addSub(c, mult)); };
  for (const r of sheet.recipes) {
    const mult = r.batches;
    addLines(r.lines, mult);
    r.subs.forEach((b) => addSub(b, mult));
    for (const s of r.starters) { add(s.flour_ingredient_id, s.flour_g * mult); add(water, s.water_g * mult); }
    for (const p of r.per_batch_items) add(p.ingredient_id, p.amount * mult);
    for (const e of r.extras) for (const l of e.lines) add(l.ingredient_id, l.total);
  }
  return out;
}

/** "12,50" / "12.5" / "" → cents (null when empty, NaN when unreadable). */
export function parseEuro(s: string): number | null {
  const t = s.trim().replace(/€/g, '').replace(/\s/g, '');
  if (!t) return null;
  const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
