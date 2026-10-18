/**
 * One-time CSV import (spec 1.5b) — pure parsing + planning, no I/O.
 *
 * Four files: ingredients.csv, recipes.csv, products.csv, recipe_lines.csv.
 * Separator `,` or `;` auto-detected from the header line; UTF-8 with or
 * without BOM; quoted fields may contain the separator and line breaks;
 * decimal comma is accepted inside quoted fields.
 *
 * The planner never guesses: an unknown ingredient name, an unknown recipe or
 * a malformed number is an error that blocks the commit. Shop products are
 * matched by their exact name and stored by product ID (spec §0).
 */

import type { StarterStage } from './types';

// ---------- CSV ----------

export function detectSeparator(text: string): ',' | ';' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const semi = (header.match(/;/g) ?? []).length;
  const comma = (header.match(/,/g) ?? []).length;
  return semi > comma ? ';' : ',';
}

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '');
  const sep = detectSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === sep) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

/** "0.05" or "0,05" (decimal comma) → number; '' → null; anything else → NaN. */
export function parseNumber(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  const normalised = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(normalised);
  return Number.isFinite(n) ? n : NaN;
}

/** `Item=amount|Item=amount` → list; errors for malformed entries. */
export function parseItemList(raw: string): { items: { name: string; amount: number }[]; errors: string[] } {
  const items: { name: string; amount: number }[] = [];
  const errors: string[] = [];
  for (const part of raw.split('|').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.lastIndexOf('=');
    if (eq < 1) { errors.push(`"${part}" is not Item=amount`); continue; }
    const name = part.slice(0, eq).trim();
    const amount = parseNumber(part.slice(eq + 1));
    if (amount === null || Number.isNaN(amount)) { errors.push(`"${part}": amount is not a number`); continue; }
    items.push({ name, amount });
  }
  return { items, errors };
}

// ---------- plan ----------

export interface ShopProduct { id: string; name: string; unit_label?: string | null; active?: boolean }

export interface PlannedIngredient {
  name: string; unit: 'g' | 'pcs'; name_de: string | null; allergens: string[] | null; components_de: string | null;
  derived_from_name: string | null; g_per_source_unit: number | null;
}
export interface PlannedStarter { name: string; maintenance_flour_name: string | null; stages: StarterStage[]; stiff_last_stage: boolean }
export interface PlannedRecipeLine { position: number; type: 'ingredient' | 'sub' | 'starter'; item: string; pct: number; final_flour: string | null; label: string | null }
export interface PlannedRecipe {
  name: string; kind: 'dough' | 'sub'; dough_margin_factor: number | null; build_margin_pct: number | null; max_batch_g: number | null;
  per_batch_items: { name: string; amount: number }[]; lines: PlannedRecipeLine[]; sum_pct: number;
}
export interface PlannedProduct {
  name: string; recipe: string; channel: 'web' | 'intern'; dough_per_unit_g: number; bake_loss_pct: number | null;
  extras: { name: string; amount: number }[]; production: 'orders' | 'stock';
  product_id: string | null; link_status: 'linked' | 'pending' | 'internal'; pieces_per_unit: number | null;
}
export interface ImportPlan {
  ingredients: PlannedIngredient[];
  starters: PlannedStarter[];
  recipes: PlannedRecipe[];
  products: PlannedProduct[];
  errors: string[];
  warnings: string[];
  unknown_items: string[];
}

const ALLERGEN_SPLIT = /\s*\|\s*/;

export function planImport(files: { ingredients: string; recipes: string; products: string; recipe_lines: string }, shopProducts: ShopProduct[]): ImportPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan: ImportPlan = { ingredients: [], starters: [], recipes: [], products: [], errors, warnings, unknown_items: [] };

  // ingredients
  const ingRows = parseCsv(files.ingredients);
  const ingNames = new Set<string>();
  for (const r of ingRows) {
    const name = r.item;
    if (!name) { errors.push('ingredients.csv: a row has no item name.'); continue; }
    if (ingNames.has(name)) { errors.push(`ingredients.csv: "${name}" appears twice.`); continue; }
    ingNames.add(name);
    const unitRaw = (r.unit || 'g').toLowerCase();
    if (unitRaw !== 'g' && unitRaw !== 'pcs') errors.push(`ingredients.csv "${name}": unit must be g or pcs (got "${r.unit}").`);
    const allergRaw = (r.allergens ?? '').trim();
    let allergens: string[] | null;
    if (allergRaw === '') { allergens = null; warnings.push(`ingredients.csv "${name}": allergens not checked yet (blocks the customer list).`); }
    else if (allergRaw.toLowerCase() === 'none') allergens = [];
    else allergens = allergRaw.split(ALLERGEN_SPLIT).filter(Boolean);
    const gps = parseNumber(r.g_per_source_unit);
    if (Number.isNaN(gps)) errors.push(`ingredients.csv "${name}": g_per_source_unit is not a number.`);
    const comp = (r.components_de ?? '').trim();
    plan.ingredients.push({
      name, unit: unitRaw === 'pcs' ? 'pcs' : 'g',
      name_de: r.name_de?.trim() || null, allergens,
      components_de: comp === '' || comp === '?' ? null : comp,
      derived_from_name: r.derived_from?.trim() || null,
      g_per_source_unit: gps ?? null,
    });
  }
  for (const i of plan.ingredients) {
    if (i.derived_from_name && !ingNames.has(i.derived_from_name)) errors.push(`ingredients.csv "${i.name}": derived_from "${i.derived_from_name}" is not an ingredient.`);
    if (i.derived_from_name && !i.g_per_source_unit) errors.push(`ingredients.csv "${i.name}": derived ingredients need g_per_source_unit.`);
  }

  // recipes
  const recRows = parseCsv(files.recipes);
  const recipes = new Map<string, PlannedRecipe>();
  for (const r of recRows) {
    const name = r.recipe;
    if (!name) { errors.push('recipes.csv: a row has no recipe name.'); continue; }
    if (recipes.has(name)) { errors.push(`recipes.csv: "${name}" appears twice.`); continue; }
    const kind = (r.kind || '').toLowerCase();
    if (kind !== 'dough' && kind !== 'sub') { errors.push(`recipes.csv "${name}": kind must be dough or sub.`); continue; }
    const dmf = parseNumber(r.dough_margin_factor);
    const bmp = parseNumber(r.build_margin_pct);
    const mbg = parseNumber(r.max_batch_g);
    for (const [k, v] of [['dough_margin_factor', dmf], ['build_margin_pct', bmp], ['max_batch_g', mbg]] as const) {
      if (Number.isNaN(v)) errors.push(`recipes.csv "${name}": ${k} is not a number.`);
    }
    if (kind === 'sub' && dmf !== null && !Number.isNaN(dmf)) warnings.push(`recipes.csv "${name}": dough_margin_factor is ignored for sub-recipes (only build_margin_pct applies).`);
    if (kind === 'dough' && bmp !== null && !Number.isNaN(bmp)) warnings.push(`recipes.csv "${name}": build_margin_pct is ignored for dough recipes.`);
    const pbi = parseItemList(r.per_batch_items ?? '');
    pbi.errors.forEach((e) => errors.push(`recipes.csv "${name}" per_batch_items: ${e}`));
    recipes.set(name, {
      name, kind,
      dough_margin_factor: kind === 'dough' ? (Number.isNaN(dmf) ? null : dmf) : null,
      build_margin_pct: kind === 'sub' ? (Number.isNaN(bmp) ? null : bmp) : null,
      max_batch_g: Number.isNaN(mbg) ? null : mbg,
      per_batch_items: pbi.items, lines: [], sum_pct: 0,
    });
  }

  // recipe lines (+ starters discovered here)
  const starters = new Map<string, PlannedStarter>();
  const starterFlours = new Map<string, Set<string>>();
  const starterStiff = new Map<string, boolean>();
  const lineRows = parseCsv(files.recipe_lines);
  const unknown = new Set<string>();
  const seenPos = new Set<string>();
  for (const r of lineRows) {
    const rec = recipes.get(r.recipe);
    if (!rec) { errors.push(`recipe_lines.csv: recipe "${r.recipe}" is not in recipes.csv.`); continue; }
    const type = (r.type || '').toLowerCase();
    if (type !== 'ingredient' && type !== 'sub' && type !== 'starter') { errors.push(`recipe_lines.csv "${r.recipe}" line ${r.position}: type must be ingredient, sub or starter.`); continue; }
    const pct = parseNumber(r.pct);
    if (pct === null || Number.isNaN(pct) || pct < 0) { errors.push(`recipe_lines.csv "${r.recipe}" line ${r.position}: pct "${r.pct}" is not a number ≥ 0.`); continue; }
    const position = parseNumber(r.position) ?? rec.lines.length + 1;
    const key = `${r.recipe}#${position}`;
    if (seenPos.has(key)) warnings.push(`recipe_lines.csv "${r.recipe}": position ${position} appears twice; order kept as in the file.`);
    seenPos.add(key);
    const item = r.item;
    if (type === 'ingredient' && !ingNames.has(item)) unknown.add(item);
    if (type === 'sub') {
      const sub = recipes.get(item);
      if (!sub) errors.push(`recipe_lines.csv "${r.recipe}": sub-recipe "${item}" is not in recipes.csv.`);
      else if (sub.kind !== 'sub') errors.push(`recipe_lines.csv "${r.recipe}": "${item}" is a dough, not a sub-recipe.`);
    }
    const finalFlour = r.final_flour?.trim() || null;
    if (type === 'starter') {
      if (finalFlour && !ingNames.has(finalFlour)) unknown.add(finalFlour);
      if (!starters.has(item)) starters.set(item, { name: item, maintenance_flour_name: null, stages: [], stiff_last_stage: false });
      if (finalFlour) {
        const set = starterFlours.get(item) ?? new Set<string>();
        set.add(finalFlour);
        starterFlours.set(item, set);
      }
      if ((r.label ?? '').toLowerCase().includes('stiff')) starterStiff.set(item, true);
    }
    rec.lines.push({ position: Number(position), type, item, pct, final_flour: finalFlour, label: r.label?.trim() || null });
  }
  for (const rec of recipes.values()) {
    rec.lines.sort((a, b) => a.position - b.position);
    rec.sum_pct = rec.lines.reduce((s, l) => s + l.pct, 0);
    if (rec.lines.length === 0) errors.push(`recipes.csv "${rec.name}": no lines in recipe_lines.csv.`);
    for (const p of rec.per_batch_items) if (!ingNames.has(p.name)) unknown.add(p.name);
  }
  // starters: stages from the spec's current values; the settings page edits them afterwards.
  for (const st of starters.values()) {
    const flours = [...(starterFlours.get(st.name) ?? [])];
    st.maintenance_flour_name = flours.length === 1 ? flours[0] : null;
    if (flours.length > 1) warnings.push(`Starter "${st.name}": lines name different final flours (${flours.join(', ')}); set the maintenance flour in Settings.`);
    if (flours.length === 0) warnings.push(`Starter "${st.name}": no final_flour given; set the maintenance flour in Settings.`);
    st.stiff_last_stage = starterStiff.get(st.name) ?? false;
    st.stages = [
      { stage_no: 1, day_offset: -1, flour_parts: 2, water_parts: st.stiff_last_stage ? 1 : 2, seed_parts: 1, flour_from_recipe: st.stiff_last_stage },
      { stage_no: 2, day_offset: -2, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
      { stage_no: 3, day_offset: -3, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
    ];
  }
  // circular subs
  const visit = (name: string, trail: string[]): string[] | null => {
    if (trail.includes(name)) return [...trail, name];
    const rec = recipes.get(name);
    if (!rec) return null;
    for (const l of rec.lines) if (l.type === 'sub') { const c = visit(l.item, [...trail, name]); if (c) return c; }
    return null;
  };
  for (const name of recipes.keys()) { const c = visit(name, []); if (c) { errors.push(`Circular sub-recipes: ${c.join(' → ')}.`); break; } }

  // products
  const shopByName = new Map(shopProducts.map((p) => [p.name, p]));
  const prodRows = parseCsv(files.products);
  const seenProducts = new Set<string>();
  for (const r of prodRows) {
    const name = r.product;
    if (!name) { errors.push('products.csv: a row has no product name.'); continue; }
    if (seenProducts.has(name)) { errors.push(`products.csv: "${name}" appears twice.`); continue; }
    seenProducts.add(name);
    const channel = (r.channel || '').toLowerCase();
    if (channel !== 'web' && channel !== 'intern') { errors.push(`products.csv "${name}": channel must be web or intern.`); continue; }
    if (!recipes.has(r.recipe)) errors.push(`products.csv "${name}": recipe "${r.recipe}" is not in recipes.csv.`);
    else if (recipes.get(r.recipe)!.kind !== 'dough') errors.push(`products.csv "${name}": "${r.recipe}" is a sub-recipe; products need a dough.`);
    const dpu = parseNumber(r.dough_per_unit_g);
    if (dpu === null || Number.isNaN(dpu) || dpu <= 0) { errors.push(`products.csv "${name}": dough_per_unit_g must be a number > 0.`); continue; }
    const bl = parseNumber(r.bake_loss_pct);
    if (Number.isNaN(bl)) errors.push(`products.csv "${name}": bake_loss_pct is not a number.`);
    const ex = parseItemList(r.extras ?? '');
    ex.errors.forEach((e) => errors.push(`products.csv "${name}" extras: ${e}`));
    for (const e of ex.items) if (!ingNames.has(e.name)) unknown.add(e.name);
    const production = (r.production || 'orders').toLowerCase();
    if (production !== 'orders' && production !== 'stock') errors.push(`products.csv "${name}": production must be orders or stock.`);
    let product_id: string | null = null;
    let link_status: PlannedProduct['link_status'] = 'internal';
    let pieces: number | null = null;
    if (channel === 'web') {
      const shop = shopByName.get(name);
      if (shop) {
        product_id = shop.id; link_status = 'linked';
        const m = (shop.unit_label ?? '').match(/^(\d+)\s*Stück$/i);
        if (m) pieces = Number(m[1]);
      } else {
        link_status = 'pending';
        warnings.push(`products.csv "${name}": not (yet) a website product — stored as pending link, linked automatically once it exists.`);
      }
    }
    plan.products.push({
      name, recipe: r.recipe, channel, dough_per_unit_g: dpu, bake_loss_pct: Number.isNaN(bl) ? null : bl,
      extras: ex.items, production: production === 'stock' ? 'stock' : 'orders', product_id, link_status, pieces_per_unit: pieces,
    });
  }

  plan.unknown_items = [...unknown].sort();
  for (const u of plan.unknown_items) errors.push(`Unknown ingredient "${u}" — add it to ingredients.csv or map it (never guessed).`);
  plan.starters = [...starters.values()];
  plan.recipes = [...recipes.values()];
  return plan;
}
