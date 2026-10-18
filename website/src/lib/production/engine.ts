/**
 * Production engine — pure functions, no I/O. Used by the server (bake-day
 * route, snapshots, xlsx) and by the browser (recipe preview, live
 * adjustments), so it must stay free of Next/Supabase imports.
 *
 * The maths follows SPEC-produktion-lager.md §1.3 exactly:
 *   factor      = total_dough / Σpct + dough_margin_factor          (per actual batch)
 *   grams(item) = pct(item) × factor
 *   sub-recipe  = needed × (1 + build_margin_pct/100), split by its own percentages, recursively
 *   starter     = needed × (1 + final_build_margin_pct/100) → last-refresh split by the stage ratio;
 *                 earlier stages: Σ seeds of all last refreshes, worked backwards per stage.
 * Margins compound along the chain (owner, 18.10.2026): dough → sub → starter.
 */

import type {
  Adjustment, BakeSheet, Demand, ExtrasBlock, GramLine, Ingredient, ProductLink, ProductQty, ProductionData,
  Recipe, RecipeBlock, RecipeItem, Starter, StarterNeed, StarterSchedule, StarterStageRow, StockProductLine,
  SubBlock, Warning,
} from './types';

// ---------- helpers ----------

export function sumPct(recipe: Recipe): number {
  return recipe.items.reduce((s, it) => s + Number(it.pct || 0), 0);
}

export function recipeMarginFactor(recipe: Recipe, settings: ProductionData['settings']): number {
  const v = recipe.dough_margin_factor;
  return v === null || v === undefined ? Number(settings.dough_margin_factor) : Number(v);
}

export function recipeBuildMargin(recipe: Recipe, settings: ProductionData['settings']): number {
  const v = recipe.build_margin_pct;
  return v === null || v === undefined ? Number(settings.build_margin_pct) : Number(v);
}

/** Calendar arithmetic on a YYYY-MM-DD string, DST-proof (UTC date parts only). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Round for display only. */
export function g(n: number): number {
  return Math.round(n);
}

function index<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- validation ----------

/** Recipe ids reachable from `recipeId` through sub items; throws on a cycle. */
export function findCycle(recipeId: string, recipes: Map<string, Recipe>, trail: string[] = []): string[] | null {
  if (trail.includes(recipeId)) return [...trail, recipeId];
  const r = recipes.get(recipeId);
  if (!r) return null;
  for (const it of r.items) {
    if (it.type === 'sub' && it.sub_recipe_id) {
      const c = findCycle(it.sub_recipe_id, recipes, [...trail, recipeId]);
      if (c) return c;
    }
  }
  return null;
}

export function validateRecipe(recipe: Recipe, data: ProductionData): string[] {
  const errors: string[] = [];
  const ingredients = index(data.ingredients);
  const recipes = index(data.recipes);
  const starters = index(data.starters);
  if (!recipe.name.trim()) errors.push('Name is required.');
  if (recipe.items.length === 0) errors.push('A recipe needs at least one line.');
  for (const it of recipe.items) {
    const n = `Line ${it.position}`;
    if (!(Number(it.pct) >= 0)) errors.push(`${n}: percentage must be a number ≥ 0.`);
    if (it.type === 'ingredient' && (!it.ingredient_id || !ingredients.has(it.ingredient_id))) errors.push(`${n}: unknown ingredient.`);
    if (it.type === 'sub') {
      if (!it.sub_recipe_id || !recipes.has(it.sub_recipe_id)) errors.push(`${n}: unknown sub-recipe.`);
      else if (recipes.get(it.sub_recipe_id)!.kind !== 'sub') errors.push(`${n}: ${recipes.get(it.sub_recipe_id)!.name} is a dough, not a sub-recipe.`);
      if (it.sub_recipe_id === recipe.id) errors.push(`${n}: a recipe cannot contain itself.`);
    }
    if (it.type === 'starter') {
      if (!it.starter_id || !starters.has(it.starter_id)) errors.push(`${n}: unknown starter.`);
      if (it.final_flour_ingredient_id && !ingredients.has(it.final_flour_ingredient_id)) errors.push(`${n}: unknown final-refresh flour.`);
    }
  }
  const withSelf = new Map(recipes);
  withSelf.set(recipe.id, recipe);
  const cycle = findCycle(recipe.id, withSelf);
  if (cycle) errors.push(`Circular sub-recipes: ${cycle.map((id) => withSelf.get(id)?.name ?? id).join(' → ')}.`);
  if (sumPct(recipe) <= 0) errors.push('The percentages add up to 0.');
  if (recipe.kind === 'sub' && recipe.dough_margin_factor !== null && recipe.dough_margin_factor !== undefined) {
    errors.push('dough_margin_factor applies to dough recipes only (ignored for subs).');
  }
  if (recipe.base_ingredient_id) {
    const base = recipe.items.filter((it) => it.type === 'ingredient' && it.ingredient_id === recipe.base_ingredient_id)
      .reduce((s, it) => s + Number(it.pct), 0);
    if (Math.abs(base - 100) > 1e-9) errors.push(`The base ingredient adds up to ${base} %, expected 100 %.`);
  }
  return errors;
}

// ---------- core expansion ----------

interface Ctx {
  data: ProductionData;
  ingredients: Map<string, Ingredient>;
  recipes: Map<string, Recipe>;
  starters: Map<string, Starter>;
  adjustments: Map<string, number>; // `${recipe_id}:${item_id}` → pct
  warnings: Warning[];
}

function makeCtx(data: ProductionData, adjustments: Adjustment[] = []): Ctx {
  const adj = new Map<string, number>();
  for (const a of adjustments) adj.set(`${a.recipe_id}:${a.item_id}`, Number(a.pct));
  return { data, ingredients: index(data.ingredients), recipes: index(data.recipes), starters: index(data.starters), adjustments: adj, warnings: [] };
}

function effectivePct(ctx: Ctx, recipe: Recipe, it: RecipeItem): { pct: number; adjusted: boolean; original: number } {
  const key = `${recipe.id}:${it.id}`;
  const original = Number(it.pct);
  if (ctx.adjustments.has(key)) return { pct: ctx.adjustments.get(key)!, adjusted: true, original };
  return { pct: original, adjusted: false, original };
}

function effectiveSum(ctx: Ctx, recipe: Recipe): number {
  return recipe.items.reduce((s, it) => s + effectivePct(ctx, recipe, it).pct, 0);
}

function ingredientLine(ctx: Ctx, recipe: Recipe, it: RecipeItem, factor: number): GramLine {
  const ing = ctx.ingredients.get(it.ingredient_id!);
  const { pct, adjusted, original } = effectivePct(ctx, recipe, it);
  const grams = pct * factor;
  const name = ing?.name ?? 'unknown ingredient';
  const line: GramLine = {
    item_id: it.id,
    label: it.label ? `${name} (${it.label})` : name,
    ingredient_id: it.ingredient_id,
    ingredient_name: name,
    unit: ing?.unit ?? 'g',
    pct,
    grams,
    adjusted,
    original_pct: adjusted ? original : null,
  };
  if (ing?.derived_from && ing.g_per_source_unit) {
    const src = ctx.ingredients.get(ing.derived_from);
    const units = grams / Number(ing.g_per_source_unit);
    const rounded = Math.ceil(units - 1e-9);
    line.source_units = units;
    line.source_units_rounded = rounded;
    line.source_name = src?.name ?? 'source';
    // The other derived ingredient of the same source (yolk ↔ white) is the by-product.
    const sibling = ctx.data.ingredients.find((x) => x.derived_from === ing.derived_from && x.id !== ing.id && x.g_per_source_unit);
    line.byproduct = sibling ? { ingredient_id: sibling.id, ingredient_name: sibling.name, grams: rounded * Number(sibling.g_per_source_unit) } : null;
  }
  return line;
}

function starterNeed(ctx: Ctx, recipe: Recipe, it: RecipeItem, factor: number): StarterNeed {
  const st = ctx.starters.get(it.starter_id!);
  const { pct } = effectivePct(ctx, recipe, it);
  const inDough = pct * factor;
  const finalBuild = inDough * (1 + Number(ctx.data.settings.final_build_margin_pct) / 100);
  const stage = st?.stages.find((s) => s.stage_no === 1);
  const parts = stage ? Number(stage.flour_parts) + Number(stage.water_parts) + Number(stage.seed_parts) : 0;
  const flourId = stage?.flour_from_recipe && it.final_flour_ingredient_id
    ? it.final_flour_ingredient_id
    : (st?.maintenance_flour_ingredient_id ?? it.final_flour_ingredient_id ?? null);
  const flourName = flourId ? (ctx.ingredients.get(flourId)?.name ?? 'flour') : 'flour';
  return {
    starter_id: it.starter_id!,
    starter_name: st?.name ?? 'unknown starter',
    item_id: it.id,
    label: it.label ? `${st?.name ?? 'starter'} (${it.label})` : (st?.name ?? 'starter'),
    in_dough_g: inDough,
    final_build_g: finalBuild,
    flour_ingredient_id: flourId,
    flour_ingredient_name: flourName,
    flour_g: parts ? finalBuild * Number(stage!.flour_parts) / parts : 0,
    water_g: parts ? finalBuild * Number(stage!.water_parts) / parts : 0,
    seed_g: parts ? finalBuild * Number(stage!.seed_parts) / parts : 0,
  };
}

function expandSub(ctx: Ctx, sub: Recipe, neededG: number, trail: string[]): SubBlock {
  const margin = recipeBuildMargin(sub, ctx.data.settings);
  const total = neededG * (1 + margin / 100);
  const sum = effectiveSum(ctx, sub);
  const factor = sum > 0 ? total / sum : 0;
  const block: SubBlock = {
    recipe_id: sub.id, name: sub.name, version: sub.current_version, needed_g: neededG, build_margin_pct: margin,
    total_g: total, sum_pct: sum, factor, lines: [], subs: [], starters: [],
  };
  for (const it of [...sub.items].sort((a, b) => a.position - b.position)) {
    if (it.type === 'ingredient') block.lines.push(ingredientLine(ctx, sub, it, factor));
    else if (it.type === 'starter') block.starters.push(starterNeed(ctx, sub, it, factor));
    else if (it.type === 'sub' && it.sub_recipe_id) {
      const child = ctx.recipes.get(it.sub_recipe_id);
      if (!child || trail.includes(child.id)) {
        ctx.warnings.push({ type: 'circular', text: `${sub.name}: sub-recipe missing or circular.`, recipe_id: sub.id });
        continue;
      }
      block.subs.push(expandSub(ctx, child, effectivePct(ctx, sub, it).pct * factor, [...trail, child.id]));
    }
  }
  return block;
}

function collectStarters(block: SubBlock, out: StarterNeed[]) {
  out.push(...block.starters);
  for (const s of block.subs) collectStarters(s, out);
}

function countEggsInLines(lines: GramLine[]): number {
  return lines.reduce((n, l) => n + (l.source_units_rounded ?? 0), 0);
}
function countEggsInSub(block: SubBlock): number {
  return countEggsInLines(block.lines) + block.subs.reduce((n, s) => n + countEggsInSub(s), 0);
}

/**
 * Expand one dough recipe for a given total dough weight. `batches` > 1 only
 * when max_batch_g forces a split; every per-batch figure (lines, subs,
 * starters, margin) is for ONE batch.
 */
export function expandDough(ctx: Ctx, recipe: Recipe, totalDoughG: number): Omit<RecipeBlock, 'products' | 'extras'> {
  const maxBatch = recipe.max_batch_g ? Number(recipe.max_batch_g) : null;
  const batches = maxBatch && totalDoughG > maxBatch ? Math.ceil(totalDoughG / maxBatch - 1e-9) : 1;
  const perBatch = totalDoughG / batches;
  const sum = effectiveSum(ctx, recipe);
  const marginFactor = recipeMarginFactor(recipe, ctx.data.settings);
  const factor = sum > 0 ? perBatch / sum + marginFactor : 0;
  const block: Omit<RecipeBlock, 'products' | 'extras'> = {
    recipe_id: recipe.id, name: recipe.name, version: recipe.current_version,
    total_dough_g: totalDoughG, sum_pct: sum, dough_margin_factor: marginFactor, margin_g_per_batch: marginFactor * sum,
    batches, max_batch_g: maxBatch, per_batch_dough_g: perBatch, factor, batch_total_g: sum * factor,
    lines: [], subs: [], starters: [], per_batch_items: [], eggs_per_batch: 0,
    adjustments_applied: 0,
  };
  for (const it of [...recipe.items].sort((a, b) => a.position - b.position)) {
    if (it.type === 'ingredient') {
      const line = ingredientLine(ctx, recipe, it, factor);
      if (line.adjusted) block.adjustments_applied++;
      block.lines.push(line);
    } else if (it.type === 'starter') {
      block.starters.push(starterNeed(ctx, recipe, it, factor));
    } else if (it.type === 'sub' && it.sub_recipe_id) {
      const child = ctx.recipes.get(it.sub_recipe_id);
      if (!child) {
        ctx.warnings.push({ type: 'unknown_item', text: `${recipe.name}: sub-recipe not found.`, recipe_id: recipe.id });
        continue;
      }
      if (findCycle(recipe.id, ctx.recipes)) {
        ctx.warnings.push({ type: 'circular', text: `${recipe.name}: circular sub-recipes, skipped.`, recipe_id: recipe.id });
        continue;
      }
      const sub = expandSub(ctx, child, effectivePct(ctx, recipe, it).pct * factor, [recipe.id, child.id]);
      block.subs.push(sub);
      collectStarters(sub, block.starters);
    }
  }
  for (const p of recipe.per_batch_items ?? []) {
    const ing = ctx.ingredients.get(p.ingredient_id);
    block.per_batch_items.push({ ingredient_id: p.ingredient_id, ingredient_name: ing?.name ?? 'unknown', unit: ing?.unit ?? 'g', amount: Number(p.amount) });
  }
  block.eggs_per_batch = countEggsInLines(block.lines)
    + block.subs.reduce((n, s) => n + countEggsInSub(s), 0)
    + block.per_batch_items.filter((p) => p.unit === 'pcs' && isEggLike(ctx, p.ingredient_id)).reduce((n, p) => n + p.amount, 0);
  if (batches > 1) {
    ctx.warnings.push({ type: 'batch_split', text: `${recipe.name}: ${g(totalDoughG)} g dough exceeds the ${g(maxBatch!)} g limit — split into ${batches} batches of ${g(perBatch)} g.`, recipe_id: recipe.id });
  }
  if (sum <= 0) ctx.warnings.push({ type: 'zero_sum', text: `${recipe.name}: percentages add up to 0.`, recipe_id: recipe.id });
  return block;
}

/** An ingredient in pieces that other ingredients derive from (the egg). */
function isEggLike(ctx: Ctx, ingredientId: string): boolean {
  return ctx.data.ingredients.some((i) => i.derived_from === ingredientId);
}

// ---------- starters ----------

function buildStarterSchedules(ctx: Ctx, date: string, needs: { recipe_name: string; need: StarterNeed; batches: number }[]): StarterSchedule[] {
  const byStarter = new Map<string, typeof needs>();
  for (const n of needs) {
    const list = byStarter.get(n.need.starter_id) ?? [];
    list.push(n);
    byStarter.set(n.need.starter_id, list);
  }
  const out: StarterSchedule[] = [];
  for (const [starterId, list] of byStarter) {
    const st = ctx.starters.get(starterId);
    if (!st) continue;
    const stages = [...st.stages].sort((a, b) => a.stage_no - b.stage_no);
    const s1 = stages[0];
    // Stage 1: one row per recipe (flour may come from the recipe). Multiply by batches.
    const perRecipe = list.map((n) => ({
      recipe_name: n.recipe_name + (n.batches > 1 ? ` (×${n.batches})` : ''),
      total_g: n.need.final_build_g * n.batches,
      flour_g: n.need.flour_g * n.batches,
      water_g: n.need.water_g * n.batches,
      seed_g: n.need.seed_g * n.batches,
      flour_ingredient_name: n.need.flour_ingredient_name,
    }));
    const rows: StarterStageRow[] = [];
    const t1 = perRecipe.reduce((s, r) => s + r.total_g, 0);
    const maintName = st.maintenance_flour_ingredient_id ? (ctx.ingredients.get(st.maintenance_flour_ingredient_id)?.name ?? 'flour') : 'flour';
    rows.push({
      stage_no: s1?.stage_no ?? 1, day_offset: s1?.day_offset ?? -1, date: addDaysISO(date, s1?.day_offset ?? -1),
      total_g: t1,
      flour_g: perRecipe.reduce((s, r) => s + r.flour_g, 0),
      water_g: perRecipe.reduce((s, r) => s + r.water_g, 0),
      seed_g: perRecipe.reduce((s, r) => s + r.seed_g, 0),
      flour_ingredient_id: null,
      flour_ingredient_name: new Set(perRecipe.map((r) => r.flour_ingredient_name)).size === 1 ? perRecipe[0].flour_ingredient_name : 'per recipe',
      per_recipe: perRecipe,
    });
    // Earlier stages: the seed of the previous (later) stage is the whole of this one. No extra margin.
    let seed = rows[0].seed_g;
    for (const stage of stages.slice(1)) {
      const parts = Number(stage.flour_parts) + Number(stage.water_parts) + Number(stage.seed_parts);
      const total = seed;
      const row: StarterStageRow = {
        stage_no: stage.stage_no, day_offset: stage.day_offset, date: addDaysISO(date, stage.day_offset),
        total_g: total,
        flour_g: total * Number(stage.flour_parts) / parts,
        water_g: total * Number(stage.water_parts) / parts,
        seed_g: total * Number(stage.seed_parts) / parts,
        flour_ingredient_id: st.maintenance_flour_ingredient_id,
        flour_ingredient_name: maintName,
      };
      rows.push(row);
      seed = row.seed_g;
    }
    out.push({ starter_id: starterId, name: st.name, stages: rows, seed_from_kept_g: seed });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- extras ----------

function extrasFor(ctx: Ctx, product: ProductLink, qty: number): ExtrasBlock | null {
  if (!product.extras || product.extras.length === 0) return null;
  return {
    pr_product_id: product.id,
    product_name: product.name,
    qty,
    lines: product.extras.map((e) => {
      const ing = ctx.ingredients.get(e.ingredient_id);
      return { ingredient_id: e.ingredient_id, ingredient_name: ing?.name ?? 'unknown', unit: 'g', per_piece: Number(e.grams), total: Number(e.grams) * qty };
    }),
  };
}

// ---------- the bake sheet ----------

export function computeBakeSheet(date: string, demands: Demand[], data: ProductionData, adjustments: Adjustment[] = []): BakeSheet {
  const ctx = makeCtx(data, adjustments);
  const products = index(data.products);

  // 1. quantities per product
  const qtyByProduct = new Map<string, ProductQty>();
  for (const d of demands) {
    if (!d.qty) continue;
    const p = d.pr_product_id ? products.get(d.pr_product_id) : undefined;
    if (!p) {
      ctx.warnings.push({ type: 'missing_recipe', text: `${d.qty}× ${d.product_name} – no recipe linked`, product_name: d.product_name, qty: d.qty });
      continue;
    }
    if (!p.recipe_id && p.production === 'orders') {
      ctx.warnings.push({ type: 'missing_recipe', text: `${d.qty}× ${d.product_name} – no recipe linked`, product_name: d.product_name, qty: d.qty });
      continue;
    }
    const row = qtyByProduct.get(p.id) ?? { pr_product_id: p.id, name: p.name, qty: 0, by_source: [], dough_per_unit_g: Number(p.dough_per_unit_g), dough_g: 0 };
    row.qty += d.qty;
    row.by_source.push({ source: d.source, qty: d.qty, reason: d.reason ?? null });
    row.dough_g = row.qty * row.dough_per_unit_g;
    qtyByProduct.set(p.id, row);
  }

  // 2. split into orders-production and stock products, group by recipe.
  //    Stock products: web/B2B/manual orders come FROM the freezer (no dough);
  //    extra quantities are what goes INTO the freezer, so they join the batch (spec 1.4, step 2).
  const stockLines: StockProductLine[] = [];
  const byRecipe = new Map<string, ProductQty[]>();
  const batchRows: ProductQty[] = [];
  for (const row of qtyByProduct.values()) {
    const p = products.get(row.pr_product_id)!;
    let batchRow: ProductQty = row;
    if (p.production === 'stock') {
      const fromFreezer = row.by_source.filter((s) => s.source !== 'extra');   // web, B2B and manual orders are delivered from stock
      const intoFreezer = row.by_source.filter((s) => s.source === 'extra');   // extras are made to refill it
      const freezerQty = fromFreezer.reduce((n, s) => n + s.qty, 0);
      if (freezerQty > 0) {
        const rec = p.recipe_id ? ctx.recipes.get(p.recipe_id) : undefined;
        stockLines.push({
          pr_product_id: p.id, name: p.name, qty: freezerQty, pieces_per_unit: p.pieces_per_unit ? Number(p.pieces_per_unit) : null,
          pieces: p.pieces_per_unit ? freezerQty * Number(p.pieces_per_unit) : null,
          recipe_id: p.recipe_id, recipe_name: rec?.name ?? null, extras: extrasFor(ctx, p, freezerQty),
        });
      }
      if (intoFreezer.length === 0) continue;
      const q = intoFreezer.reduce((n, s) => n + s.qty, 0);
      batchRow = { ...row, qty: q, by_source: intoFreezer, dough_g: q * row.dough_per_unit_g };
    }
    if (!p.recipe_id) {
      ctx.warnings.push({ type: 'missing_recipe', text: `${batchRow.qty}× ${p.name} – no recipe linked`, product_name: p.name, qty: batchRow.qty });
      continue;
    }
    batchRows.push(batchRow);
    const list = byRecipe.get(p.recipe_id) ?? [];
    list.push(batchRow);
    byRecipe.set(p.recipe_id, list);
  }

  // 3. one batch (or n) per recipe
  const recipeBlocks: RecipeBlock[] = [];
  const starterNeeds: { recipe_name: string; need: StarterNeed; batches: number }[] = [];
  const versions: Record<string, number> = {};
  for (const [recipeId, rows] of byRecipe) {
    const recipe = ctx.recipes.get(recipeId);
    if (!recipe) {
      for (const r of rows) ctx.warnings.push({ type: 'missing_recipe', text: `${r.qty}× ${r.name} – recipe not found`, product_name: r.name, qty: r.qty });
      continue;
    }
    const total = rows.reduce((s, r) => s + r.dough_g, 0);
    const core = expandDough(ctx, recipe, total);
    const block: RecipeBlock = {
      ...core,
      products: rows.sort((a, b) => b.qty - a.qty),
      extras: rows.map((r) => extrasFor(ctx, products.get(r.pr_product_id)!, r.qty)).filter((x): x is ExtrasBlock => !!x),
    };
    recipeBlocks.push(block);
    versions[recipe.id] = recipe.current_version;
    const collectVersions = (s: SubBlock) => { versions[s.recipe_id] = s.version; s.subs.forEach(collectVersions); };
    block.subs.forEach(collectVersions);
    for (const need of block.starters) starterNeeds.push({ recipe_name: recipe.name, need, batches: block.batches });
  }
  recipeBlocks.sort((a, b) => b.total_dough_g - a.total_dough_g);

  // 4. starters
  const starters = buildStarterSchedules(ctx, date, starterNeeds);

  const eggs = recipeBlocks.reduce((n, b) => n + b.eggs_per_batch * b.batches, 0);
  return {
    date,
    warnings: ctx.warnings,
    products: batchRows.sort((a, b) => b.qty - a.qty),
    stock_products: stockLines.sort((a, b) => a.name.localeCompare(b.name)),
    recipes: recipeBlocks,
    starters,
    totals: { eggs },
    versions,
  };
}

/** Recipe preview: "calculate for n pieces of product X" (spec 1.5). */
export function previewForPieces(recipe: Recipe, pieces: number, doughPerUnitG: number, data: ProductionData, adjustments: Adjustment[] = []) {
  const ctx = makeCtx(data, adjustments);
  const block = expandDough(ctx, recipe, pieces * doughPerUnitG);
  const needs = block.starters.map((need) => ({ recipe_name: recipe.name, need, batches: block.batches }));
  return { block, starters: buildStarterSchedules(ctx, '2000-01-10', needs), warnings: ctx.warnings };
}

/**
 * "Make batch" calculator (stock products such as amaretti): fix the amount
 * of the base ingredient (e.g. 40 g egg white) and scale the rest. Dough
 * margin does not apply — it is a batch, not an order.
 */
export function previewForBaseAmount(recipe: Recipe, baseIngredientId: string, baseGrams: number, data: ProductionData) {
  const ctx = makeCtx(data);
  const basePct = recipe.items.filter((it) => it.type === 'ingredient' && it.ingredient_id === baseIngredientId).reduce((s, it) => s + Number(it.pct), 0);
  const factor = basePct > 0 ? baseGrams / basePct : 0;
  const lines = [...recipe.items].sort((a, b) => a.position - b.position)
    .filter((it) => it.type === 'ingredient')
    .map((it) => ingredientLine(ctx, recipe, it, factor));
  const total = sumPct(recipe) * factor;
  return { factor, lines, total_g: total, base_pct: basePct };
}
