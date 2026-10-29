/**
 * Data access for the production module (browser via RLS, server via the
 * service role, scripts via .credentials). Relative imports only, so
 * scripts/production-import.ts can run it outside Next.
 *
 * Every function takes a Supabase client: the API routes pass the service
 * role (after requireAdmin), the import script passes it from .credentials.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adjustment, B2BClient, BakeSheet, DayOverride, Delivery, DeliveryLine, Demand, Ingredient, LedgerRow, ManualOrder, ProductLink, ProductionData, Recipe, RecipeItem, StandingOrder, Supplier, SupplierItem, Starter } from './types';
import type { ImportPlan } from './csvImport';
import { computeBakeSheet } from './engine.ts';
import { berlinTodayISO } from './bakeDays.ts';
import { b2bDemands, b2bDays, planB2BDay, type PlannedClient } from './b2b.ts';
import { freezerStatus, type AheadDemand, type FreezerMovement, type FreezerSettings, type FreezerStatus } from './freezer.ts';
import { addDays, isBakeDay } from './bakeDays.ts';
import { dayConsumption } from './stock.ts';

type DB = SupabaseClient;

function num(v: unknown): number { return v === null || v === undefined ? 0 : Number(v); }
function numOrNull(v: unknown): number | null { return v === null || v === undefined || v === '' ? null : Number(v); }

// ---------- loading ----------

export async function loadProductionData(db: DB): Promise<ProductionData> {
  const [ing, st, stages, rec, items, prod, settings] = await Promise.all([
    db.from('pr_ingredients').select('*').order('name'),
    db.from('pr_starters').select('*').order('name'),
    db.from('pr_starter_stages').select('*').order('stage_no'),
    db.from('pr_recipes').select('*').order('name'),
    db.from('pr_recipe_items').select('*').order('position'),
    db.from('pr_products').select('*').order('name'),
    db.from('pr_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  for (const r of [ing, st, stages, rec, items, prod, settings]) if (r.error) throw new Error(r.error.message);

  const ingredients: Ingredient[] = (ing.data ?? []).map((r) => ({
    id: r.id, name: r.name, unit: r.unit, name_de: r.name_de, allergens: r.allergens, components_de: r.components_de,
    derived_from: r.derived_from, g_per_source_unit: numOrNull(r.g_per_source_unit), notes: r.notes,
    track_stock: r.track_stock !== false, track_bbf: !!r.track_bbf, reorder_level: numOrNull(r.reorder_level),
  }));
  const starters: Starter[] = (st.data ?? []).map((s) => ({
    id: s.id, name: s.name, maintenance_flour_ingredient_id: s.maintenance_flour_ingredient_id,
    stages: (stages.data ?? []).filter((x) => x.starter_id === s.id).map((x) => ({
      id: x.id, stage_no: x.stage_no, day_offset: x.day_offset, flour_parts: num(x.flour_parts), water_parts: num(x.water_parts),
      seed_parts: num(x.seed_parts), flour_from_recipe: !!x.flour_from_recipe,
    })),
  }));
  const recipes: Recipe[] = (rec.data ?? []).map((r) => ({
    id: r.id, name: r.name, kind: r.kind, base_ingredient_id: r.base_ingredient_id,
    dough_margin_factor: numOrNull(r.dough_margin_factor), build_margin_pct: numOrNull(r.build_margin_pct), max_batch_g: numOrNull(r.max_batch_g),
    per_batch_items: (r.per_batch_items ?? []).map((p: { ingredient_id: string; amount: unknown }) => ({ ingredient_id: p.ingredient_id, amount: num(p.amount) })),
    current_version: r.current_version, notes: r.notes,
    items: (items.data ?? []).filter((x) => x.recipe_id === r.id).map((x): RecipeItem => ({
      id: x.id, position: x.position, type: x.type, ingredient_id: x.ingredient_id, sub_recipe_id: x.sub_recipe_id, starter_id: x.starter_id,
      final_flour_ingredient_id: x.final_flour_ingredient_id, pct: num(x.pct), label: x.label,
    })),
  }));
  const products: ProductLink[] = (prod.data ?? []).map((p) => ({
    id: p.id, product_id: p.product_id, name: p.name, channel: p.channel, recipe_id: p.recipe_id, dough_per_unit_g: num(p.dough_per_unit_g),
    bake_loss_pct: numOrNull(p.bake_loss_pct), extras: (p.extras ?? []).map((e: { ingredient_id: string; grams: unknown }) => ({ ingredient_id: e.ingredient_id, grams: num(e.grams) })),
    production: p.production, pieces_per_unit: numOrNull(p.pieces_per_unit), pieces_from_shop: !!p.pieces_from_shop, link_status: p.link_status,
    b2b_net_price_cents: p.b2b_net_price_cents === null || p.b2b_net_price_cents === undefined ? null : Number(p.b2b_net_price_cents),
  }));
  const s = settings.data;
  return {
    ingredients, starters, recipes, products,
    settings: { dough_margin_factor: s ? num(s.dough_margin_factor) : 0.1, build_margin_pct: s ? num(s.build_margin_pct) : 10, final_build_margin_pct: s ? num(s.final_build_margin_pct) : 10 },
  };
}

/**
 * Which orders count (spec 1.2): the SAME selection as the production-plan
 * export (src/app/api/admin/production-plan/route.ts) — pickup day = bake day,
 * every status except cancelled/refunded — minus TEST- orders (owner,
 * 18.10.2026: nothing is ever baked for a test order). Keep the two in step.
 */
export async function loadWebDemand(db: DB, date: string, products: ProductLink[]): Promise<Demand[]> {
  const { data, error } = await db
    .from('orders')
    .select('order_number, order_items(quantity, product_id, products(name))')
    .not('status', 'in', '("cancelled","refunded")')
    .eq('fulfillment_date', date)
    .limit(10000);
  if (error) throw new Error(error.message);
  const byShopId = new Map(products.filter((p) => p.product_id).map((p) => [p.product_id!, p]));
  const qty = new Map<string, { name: string; qty: number; product_id: string | null }>();
  for (const o of data ?? []) {
    if ((o.order_number ?? '').startsWith('TEST-')) continue;
    for (const it of (o.order_items ?? []) as { quantity: number; product_id: string | null; products?: { name?: string } | null }[]) {
      const key = it.product_id ?? `name:${it.products?.name ?? 'Unbekannt'}`;
      const row = qty.get(key) ?? { name: it.products?.name ?? 'Unbekannt', qty: 0, product_id: it.product_id };
      row.qty += Number(it.quantity || 0);
      qty.set(key, row);
    }
  }
  return [...qty.values()].map((r) => ({
    pr_product_id: r.product_id ? (byShopId.get(r.product_id)?.id ?? null) : null,
    product_name: r.name, qty: r.qty, source: 'web' as const,
  }));
}

// ---------- step 2: B2B ----------

export interface B2BData { clients: B2BClient[]; standing: StandingOrder[] }

function items(v: unknown): { pr_product_id: string; qty: number }[] {
  return Array.isArray(v) ? v.map((i: { pr_product_id: string; qty: unknown }) => ({ pr_product_id: i.pr_product_id, qty: num(i.qty) })) : [];
}

export async function loadB2B(db: DB): Promise<B2BData> {
  const [c, s] = await Promise.all([
    db.from('pr_b2b_clients').select('*').order('name'),
    db.from('pr_standing_orders').select('*').order('weekday'),
  ]);
  if (c.error) throw new Error(c.error.message);
  if (s.error) throw new Error(s.error.message);
  return {
    clients: (c.data ?? []).map((x) => ({ id: x.id, name: x.name, notes: x.notes, active: !!x.active })),
    standing: (s.data ?? []).map((x) => ({ id: x.id, client_id: x.client_id, weekday: x.weekday, items: items(x.items), valid_from: x.valid_from, valid_to: x.valid_to, active: !!x.active, notes: x.notes })),
  };
}

export interface B2BDay { planned: PlannedClient[]; manual: ManualOrder[]; overrides: DayOverride[]; clients: B2BClient[]; standing: StandingOrder[] }

export async function loadB2BDay(db: DB, date: string): Promise<B2BDay> {
  const [{ clients, standing }, o, m] = await Promise.all([
    loadB2B(db),
    db.from('pr_b2b_day_overrides').select('*').eq('date', date),
    db.from('pr_manual_orders').select('*').eq('date', date).order('created_at'),
  ]);
  if (o.error) throw new Error(o.error.message);
  if (m.error) throw new Error(m.error.message);
  const overrides: DayOverride[] = (o.data ?? []).map((x) => ({ id: x.id, client_id: x.client_id, date: x.date, skip: !!x.skip, items: x.items === null ? null : items(x.items), note: x.note }));
  const manual: ManualOrder[] = (m.data ?? []).map((x) => ({ id: x.id, date: x.date, type: x.type, client_id: x.client_id, label: x.label, items: items(x.items), notes: x.notes }));
  const plan = planB2BDay(date, clients, standing, overrides, manual);
  return { ...plan, overrides, clients, standing };
}

/** B2B days (standing or one-off, not skipped) in [from, to]. */
export async function loadB2BDaysBetween(db: DB, from: string, to: string): Promise<string[]> {
  const [{ clients, standing }, o, m] = await Promise.all([
    loadB2B(db),
    db.from('pr_b2b_day_overrides').select('*').gte('date', from).lte('date', to),
    db.from('pr_manual_orders').select('*').gte('date', from).lte('date', to),
  ]);
  if (o.error) throw new Error(o.error.message);
  if (m.error) throw new Error(m.error.message);
  const overrides: DayOverride[] = (o.data ?? []).map((x) => ({ id: x.id, client_id: x.client_id, date: x.date, skip: !!x.skip, items: x.items === null ? null : items(x.items), note: x.note }));
  const manual: ManualOrder[] = (m.data ?? []).map((x) => ({ id: x.id, date: x.date, type: x.type, client_id: x.client_id, label: x.label, items: items(x.items), notes: x.notes }));
  return b2bDays(from, to, clients, standing, overrides, manual);
}

// ---------- step 2: freezer ----------

export async function loadFreezerRaw(db: DB): Promise<{ settings: FreezerSettings[]; movements: FreezerMovement[] }> {
  const [st, mv] = await Promise.all([
    db.from('pr_freezer_settings').select('*'),
    db.from('pr_freezer_movements').select('*').order('date').order('created_at'),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (mv.error) throw new Error(mv.error.message);
  return {
    settings: (st.data ?? []).map((x) => ({ pr_product_id: x.pr_product_id, batch_size: num(x.batch_size), min_level: num(x.min_level), max_age_days: x.max_age_days ?? null })),
    movements: (mv.data ?? []).map((x) => ({ id: x.id, pr_product_id: x.pr_product_id, date: x.date, kind: x.kind, qty: num(x.qty), note: x.note })),
  };
}

/** Pieces of each stock product delivered from the freezer on a date (web + B2B + manual, in pieces). */
async function freezerUsageOn(db: DB, date: string, data: ProductionData): Promise<Map<string, { pieces: number; who: string[] }>> {
  const b2b = await loadB2BDay(db, date);
  const web = await loadWebDemand(db, date, data.products);
  const out = new Map<string, { pieces: number; who: string[] }>();
  for (const d of [...web, ...b2bDemands(b2b, data.products, b2b.clients)]) {
    if (!d.pr_product_id) continue;
    const p = data.products.find((x) => x.id === d.pr_product_id);
    if (!p || p.production !== 'stock') continue;
    const per = p.pieces_per_unit ? Number(p.pieces_per_unit) : 1;
    const row = out.get(p.id) ?? { pieces: 0, who: [] };
    row.pieces += d.qty * per;
    row.who.push(d.source === 'web' ? `web ${d.qty}` : `${d.reason ?? d.source} ${d.qty}`);
    out.set(p.id, row);
  }
  return out;
}

/**
 * Freezer status of every stock product for a bake day, with the demand of the
 * following two bake days (one week: until the same weekday comes round again,
 * which is the next chance to bake the same dough).
 */
export async function loadFreezer(db: DB, date: string, data: ProductionData, extras: { pr_product_id: string; qty: number }[]): Promise<FreezerStatus[]> {
  const stockProducts = data.products.filter((p) => p.production === 'stock');
  if (stockProducts.length === 0) return [];
  const { settings, movements } = await loadFreezerRaw(db);
  const today = await freezerUsageOn(db, date, data);
  // the next two shop bake days, plus any B2B-only days in between (B2B deliveries can fall on any weekday)
  const shopDays: string[] = [];
  for (let d = addDays(date, 1); shopDays.length < 2; d = addDays(d, 1)) if (isBakeDay(d)) shopDays.push(d);
  const extraDays = await loadB2BDaysBetween(db, addDays(date, 1), shopDays[1]);
  const nextDays = [...new Set([...shopDays, ...extraDays])].sort();
  const aheadByDay = await Promise.all(nextDays.map(async (d) => [d, await freezerUsageOn(db, d, data)] as const));
  return stockProducts.map((p) => {
    const st = settings.find((s) => s.pr_product_id === p.id) ?? { pr_product_id: p.id, batch_size: 1, min_level: 0, max_age_days: null };
    const mine = movements.filter((m) => m.pr_product_id === p.id);
    const per = p.pieces_per_unit ? Number(p.pieces_per_unit) : 1;
    const usage = today.get(p.id)?.pieces ?? 0;
    const extra = extras.filter((e) => e.pr_product_id === p.id).reduce((n, e) => n + Number(e.qty) * per, 0);
    const ahead: AheadDemand[] = aheadByDay.flatMap(([d, m]) => { const u = m.get(p.id); return u ? [{ date: d, pieces: u.pieces, who: u.who.join(', ') }] : []; });
    return freezerStatus(p, st, mine, date, usage, extra, ahead);
  });
}

/** Book today's freezer usage once (idempotent) — called when a bake day is frozen. */
export async function bookFreezerUsage(db: DB, date: string, data: ProductionData): Promise<void> {
  const usage = await freezerUsageOn(db, date, data);
  for (const [pid, u] of usage) {
    if (u.pieces <= 0) continue;
    const { error } = await db.from('pr_freezer_movements').upsert({ pr_product_id: pid, date, kind: 'usage', qty: -u.pieces, note: u.who.join(', ') }, { onConflict: 'pr_product_id,date,kind' });
    if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  }
}

export interface BakeDayRow {
  date: string;
  extra_quantities: { pr_product_id: string; qty: number; reason: string | null }[];
  adjustments: Adjustment[];
  notes: string | null;
  snapshot: BakeSheet | null;
  snapshot_at: string | null;
  consumed_at: string | null;   // stock consumption booked (step 4)
}

export async function loadBakeDayRow(db: DB, date: string): Promise<BakeDayRow> {
  const { data, error } = await db.from('pr_bake_days').select('*').eq('date', date).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    date,
    extra_quantities: (data?.extra_quantities ?? []).map((e: { pr_product_id: string; qty: unknown; reason?: string | null }) => ({ pr_product_id: e.pr_product_id, qty: num(e.qty), reason: e.reason ?? null })),
    adjustments: (data?.adjustments ?? []).map((a: { recipe_id: string; item_id: string; pct: unknown }) => ({ recipe_id: a.recipe_id, item_id: a.item_id, pct: num(a.pct) })),
    notes: data?.notes ?? null,
    snapshot: data?.snapshot ?? null,
    snapshot_at: data?.snapshot_at ?? null,
    consumed_at: data?.consumed_at ?? null,
  };
}

/** Link pending web products whose name now exists in the shop (spec 1.5b). */
export async function autoLinkPending(db: DB): Promise<string[]> {
  const { data: pending } = await db.from('pr_products').select('id, name').eq('link_status', 'pending');
  if (!pending || pending.length === 0) return [];
  const { data: shop } = await db.from('products').select('id, name, unit_label').in('name', pending.map((p) => p.name));
  const linked: string[] = [];
  for (const p of pending) {
    const s = (shop ?? []).find((x) => x.name === p.name);
    if (!s) continue;
    const m = (s.unit_label ?? '').match(/^(\d+)\s*Stück$/i);
    const { error } = await db.from('pr_products').update({ product_id: s.id, link_status: 'linked', pieces_per_unit: m ? Number(m[1]) : null, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (!error) linked.push(p.name);
  }
  return linked;
}

/**
 * The bake sheet for a date: live until the bake day is over, then frozen.
 * The first look at a past day without a snapshot computes and stores one
 * (spec 1.4: "after that a snapshot is saved").
 */
export async function getBakeSheet(db: DB, date: string, opts: { forceLive?: boolean } = {}): Promise<{ sheet: BakeSheet; row: BakeDayRow; frozen: boolean; data: ProductionData; b2b: B2BDay; web: Demand[] }> {
  await autoLinkPending(db);
  const [data, rawRow, b2b] = await Promise.all([loadProductionData(db), loadBakeDayRow(db, date), loadB2BDay(db, date)]);
  // Overrides of recipe lines that no longer exist (the recipe was saved as a new version since) are ignored.
  const row: BakeDayRow = { ...rawRow, adjustments: rawRow.adjustments.filter((a) => data.recipes.find((r) => r.id === a.recipe_id)?.items.some((it) => it.id === a.item_id)) };
  const past = date < berlinTodayISO();
  const web = await loadWebDemand(db, date, data.products);
  if (row.snapshot && !opts.forceLive) return { sheet: row.snapshot, row, frozen: true, data, b2b, web };
  const byId = new Map(data.products.map((p) => [p.id, p]));
  const extras: Demand[] = row.extra_quantities.map((e) => ({ pr_product_id: e.pr_product_id, product_name: byId.get(e.pr_product_id)?.name ?? 'unknown product', qty: e.qty, source: 'extra', reason: e.reason ?? 'Freezer stock' }));
  const sheet = computeBakeSheet(date, [...web, ...b2bDemands(b2b, data.products, b2b.clients), ...extras], data, row.adjustments);
  if (past && !opts.forceLive) {
    const { error } = await db.from('pr_bake_days').upsert({ date, snapshot: sheet, snapshot_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'date' });
    if (error) throw new Error(error.message);
    await bookFreezerUsage(db, date, data);
    return { sheet, row: { ...row, snapshot: sheet }, frozen: true, data, b2b, web };
  }
  return { sheet, row, frozen: false, data, b2b, web };
}

// ---------- writing ----------

export interface RecipeInput {
  id?: string | null;
  name: string;
  kind: 'dough' | 'sub';
  base_ingredient_id: string | null;
  dough_margin_factor: number | null;
  build_margin_pct: number | null;
  max_batch_g: number | null;
  per_batch_items: { ingredient_id: string; amount: number }[];
  notes: string | null;
  items: { id?: string | null; position: number; type: 'ingredient' | 'sub' | 'starter'; ingredient_id: string | null; sub_recipe_id: string | null; starter_id: string | null; final_flour_ingredient_id: string | null; pct: number; label: string | null }[];
}

/** Insert or update a recipe, replace its lines, and write the next version. */
export async function saveRecipe(db: DB, input: RecipeInput, versionNote: string | null): Promise<{ id: string; version: number }> {
  const now = new Date().toISOString();
  let id = input.id ?? null;
  let version = 1;
  const head = {
    name: input.name.trim(), kind: input.kind, base_ingredient_id: input.base_ingredient_id,
    dough_margin_factor: input.kind === 'dough' ? input.dough_margin_factor : null,
    build_margin_pct: input.kind === 'sub' ? input.build_margin_pct : null,
    max_batch_g: input.max_batch_g, per_batch_items: input.per_batch_items, notes: input.notes, updated_at: now,
  };
  if (id) {
    const { data: cur, error } = await db.from('pr_recipes').select('current_version').eq('id', id).single();
    if (error) throw new Error(error.message);
    version = (cur.current_version ?? 0) + 1;
    const { error: e2 } = await db.from('pr_recipes').update({ ...head, current_version: version }).eq('id', id);
    if (e2) throw new Error(e2.message);
    const { error: e3 } = await db.from('pr_recipe_items').delete().eq('recipe_id', id);
    if (e3) throw new Error(e3.message);
  } else {
    const { data, error } = await db.from('pr_recipes').insert({ ...head, current_version: 1 }).select('id').single();
    if (error) throw new Error(error.message);
    id = data.id;
  }
  const rows = input.items.map((it, i) => ({
    recipe_id: id, position: it.position ?? i + 1, type: it.type,
    ingredient_id: it.type === 'ingredient' ? it.ingredient_id : null,
    sub_recipe_id: it.type === 'sub' ? it.sub_recipe_id : null,
    starter_id: it.type === 'starter' ? it.starter_id : null,
    final_flour_ingredient_id: it.type === 'starter' ? it.final_flour_ingredient_id : null,
    pct: it.pct, label: it.label || null,
  }));
  if (rows.length) {
    const { error } = await db.from('pr_recipe_items').insert(rows);
    if (error) throw new Error(error.message);
  }
  const { data: saved } = await db.from('pr_recipe_items').select('*').eq('recipe_id', id).order('position');
  const { error: ev } = await db.from('pr_recipe_versions').insert({ recipe_id: id, version_no: version, note: versionNote, snapshot: { ...head, items: saved ?? [] } });
  if (ev) throw new Error(ev.message);
  return { id: id!, version };
}

/** Write an import plan (csvImport.planImport) into the pr_ tables. Fails if anything already exists unless `replace`. */
export async function commitImportPlan(db: DB, plan: ImportPlan, opts: { replace?: boolean } = {}): Promise<{ ingredients: number; starters: number; recipes: number; products: number }> {
  if (plan.errors.length) throw new Error(`Plan has ${plan.errors.length} error(s); nothing written.`);
  const { count } = await db.from('pr_recipes').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0 && !opts.replace) throw new Error('Recipes already exist. The CSV import is a one-time import; maintain recipes in the interface, or choose "replace everything".');
  if (opts.replace) {
    for (const t of ['pr_recipe_versions', 'pr_recipe_items', 'pr_products', 'pr_recipes', 'pr_starter_stages', 'pr_starters', 'pr_ingredients']) {
      const { error } = await db.from(t).delete().not('created_at', 'is', null);
      if (error) throw new Error(`${t}: ${error.message}`);
    }
  }
  // ingredients (two passes: derived_from needs ids)
  const { data: ingRows, error: e1 } = await db.from('pr_ingredients').insert(plan.ingredients.map((i) => ({
    name: i.name, unit: i.unit, name_de: i.name_de, allergens: i.allergens, components_de: i.components_de, g_per_source_unit: i.g_per_source_unit,
  }))).select('id, name');
  if (e1) throw new Error(e1.message);
  const ingId = new Map((ingRows ?? []).map((r) => [r.name, r.id]));
  for (const i of plan.ingredients) {
    if (!i.derived_from_name) continue;
    const { error } = await db.from('pr_ingredients').update({ derived_from: ingId.get(i.derived_from_name) }).eq('id', ingId.get(i.name));
    if (error) throw new Error(error.message);
  }
  // starters
  const starterId = new Map<string, string>();
  for (const s of plan.starters) {
    const { data, error } = await db.from('pr_starters').insert({ name: s.name, maintenance_flour_ingredient_id: s.maintenance_flour_name ? ingId.get(s.maintenance_flour_name) ?? null : null }).select('id').single();
    if (error) throw new Error(error.message);
    starterId.set(s.name, data.id);
    const { error: e2 } = await db.from('pr_starter_stages').insert(s.stages.map((st) => ({ starter_id: data.id, stage_no: st.stage_no, day_offset: st.day_offset, flour_parts: st.flour_parts, water_parts: st.water_parts, seed_parts: st.seed_parts, flour_from_recipe: st.flour_from_recipe })));
    if (e2) throw new Error(e2.message);
  }
  // recipes: heads first (subs need ids), then lines + version 1
  const recipeId = new Map<string, string>();
  for (const r of plan.recipes) {
    const { data, error } = await db.from('pr_recipes').insert({
      name: r.name, kind: r.kind, dough_margin_factor: r.dough_margin_factor, build_margin_pct: r.build_margin_pct, max_batch_g: r.max_batch_g,
      per_batch_items: r.per_batch_items.map((p) => ({ ingredient_id: ingId.get(p.name), amount: p.amount })), current_version: 0,
    }).select('id').single();
    if (error) throw new Error(`${r.name}: ${error.message}`);
    recipeId.set(r.name, data.id);
  }
  for (const r of plan.recipes) {
    const id = recipeId.get(r.name)!;
    const items = r.lines.map((l) => ({
      recipe_id: id, position: l.position, type: l.type,
      ingredient_id: l.type === 'ingredient' ? ingId.get(l.item) : null,
      sub_recipe_id: l.type === 'sub' ? recipeId.get(l.item) : null,
      starter_id: l.type === 'starter' ? starterId.get(l.item) : null,
      final_flour_ingredient_id: l.type === 'starter' && l.final_flour ? ingId.get(l.final_flour) ?? null : null,
      pct: l.pct, label: l.label,
    }));
    const { data: saved, error } = await db.from('pr_recipe_items').insert(items).select('*');
    if (error) throw new Error(`${r.name} lines: ${error.message}`);
    const { error: e2 } = await db.from('pr_recipe_versions').insert({ recipe_id: id, version_no: 1, note: 'CSV import', snapshot: { name: r.name, kind: r.kind, dough_margin_factor: r.dough_margin_factor, build_margin_pct: r.build_margin_pct, max_batch_g: r.max_batch_g, per_batch_items: r.per_batch_items, items: saved } });
    if (e2) throw new Error(e2.message);
    const { error: e3 } = await db.from('pr_recipes').update({ current_version: 1 }).eq('id', id);
    if (e3) throw new Error(e3.message);
  }
  // products
  const { error: ep } = await db.from('pr_products').insert(plan.products.map((p) => ({
    product_id: p.product_id, name: p.name, channel: p.channel, recipe_id: recipeId.get(p.recipe) ?? null, dough_per_unit_g: p.dough_per_unit_g,
    bake_loss_pct: p.bake_loss_pct, extras: p.extras.map((e) => ({ ingredient_id: ingId.get(e.name), grams: e.amount })),
    production: p.production, pieces_per_unit: p.pieces_per_unit, link_status: p.link_status,
  })));
  if (ep) throw new Error(ep.message);
  return { ingredients: plan.ingredients.length, starters: plan.starters.length, recipes: plan.recipes.length, products: plan.products.length };
}

// ---------- CSV export (backup) ----------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** The four CSV files back out of the database, in the import format. */
export function exportCsv(data: ProductionData): { ingredients: string; recipes: string; products: string; recipe_lines: string } {
  const ingName = new Map(data.ingredients.map((i) => [i.id, i.name]));
  const recName = new Map(data.recipes.map((r) => [r.id, r.name]));
  const stName = new Map(data.starters.map((s) => [s.id, s.name]));
  const list = (items: { ingredient_id: string; amount?: number; grams?: number }[]) => items.map((p) => `${ingName.get(p.ingredient_id) ?? '?'}=${p.amount ?? p.grams}`).join('|');
  return {
    ingredients: csv(['item', 'name_de', 'allergens', 'components_de', 'unit', 'derived_from', 'g_per_source_unit'],
      data.ingredients.map((i) => [i.name, i.name_de, i.allergens === null ? '' : i.allergens.length ? i.allergens.join('|') : 'none', i.components_de, i.unit, i.derived_from ? ingName.get(i.derived_from) : '', i.g_per_source_unit])),
    recipes: csv(['recipe', 'kind', 'dough_margin_factor', 'build_margin_pct', 'max_batch_g', 'per_batch_items'],
      data.recipes.map((r) => [r.name, r.kind, r.dough_margin_factor, r.build_margin_pct, r.max_batch_g, list(r.per_batch_items)])),
    products: csv(['product', 'recipe', 'channel', 'dough_per_unit_g', 'bake_loss_pct', 'extras', 'production'],
      data.products.map((p) => [p.name, p.recipe_id ? recName.get(p.recipe_id) : '', p.channel, p.dough_per_unit_g, p.bake_loss_pct, list(p.extras), p.production])),
    recipe_lines: csv(['recipe', 'position', 'type', 'item', 'pct', 'final_flour', 'label'],
      data.recipes.flatMap((r) => r.items.map((it) => [r.name, it.position, it.type,
        it.type === 'ingredient' ? ingName.get(it.ingredient_id!) : it.type === 'sub' ? recName.get(it.sub_recipe_id!) : stName.get(it.starter_id!),
        it.pct, it.final_flour_ingredient_id ? ingName.get(it.final_flour_ingredient_id) : '', it.label]))),
  };
}

// ---------- steps 3 + 4: deliveries, ledger, costs ----------

export interface StockRaw { suppliers: Supplier[]; deliveries: Delivery[]; ledger: LedgerRow[]; supplier_items: SupplierItem[] }

export async function loadStockRaw(db: DB): Promise<StockRaw> {
  const [sup, del, lines, led, items] = await Promise.all([
    db.from('pr_suppliers').select('*').order('name'),
    db.from('pr_deliveries').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('pr_delivery_lines').select('*').order('position'),
    db.from('pr_stock_ledger').select('*').order('date').order('created_at'),
    db.from('pr_supplier_items').select('*'),
  ]);
  for (const r of [sup, del, lines, led, items]) if (r.error) throw new Error(r.error.message);
  const byDelivery = new Map<string, DeliveryLine[]>();
  for (const l of lines.data ?? []) {
    const arr = byDelivery.get(l.delivery_id) ?? [];
    arr.push({ id: l.id, position: l.position, ingredient_id: l.ingredient_id, item_text: l.item_text, qty: num(l.qty), pack_amount: num(l.pack_amount), amount: num(l.amount), price_cents: Number(l.price_cents), bbf: l.bbf });
    byDelivery.set(l.delivery_id, arr);
  }
  return {
    suppliers: (sup.data ?? []).map((s) => ({ id: s.id, name: s.name, notes: s.notes })),
    deliveries: (del.data ?? []).map((d) => ({
      id: d.id, supplier_id: d.supplier_id, date: d.date, invoice_no: d.invoice_no, delivery_fee_cents: Number(d.delivery_fee_cents), status: d.status, source: d.source,
      file_path: d.file_path ?? null, notes: d.notes, confirmed_at: d.confirmed_at, lines: byDelivery.get(d.id) ?? [],
    })),
    ledger: (led.data ?? []).map((r) => ({ id: r.id, ingredient_id: r.ingredient_id, date: r.date, kind: r.kind, amount: num(r.amount), ref_type: r.ref_type, ref_id: r.ref_id, note: r.note, created_at: r.created_at })),
    supplier_items: (items.data ?? []).map((i) => ({ supplier_id: i.supplier_id, ingredient_id: i.ingredient_id, item_text: i.item_text, pack_amount: num(i.pack_amount) })),
  };
}

export interface DeliveryInput {
  id?: string; supplier_id: string | null; date: string; invoice_no: string | null; delivery_fee_cents: number; notes: string | null;
  file_path?: string | null; source?: 'manual' | 'upload' | 'email';
  lines: { ingredient_id: string | null; item_text: string | null; qty: number; pack_amount: number; price_cents: number; bbf: string | null }[];
}

/** Insert or replace a DRAFT delivery with its lines (confirmed ones are not editable; unconfirm first). */
export async function saveDraftDelivery(db: DB, input: DeliveryInput): Promise<string> {
  const now = new Date().toISOString();
  let id = input.id;
  if (id) {
    const { data: cur, error: e0 } = await db.from('pr_deliveries').select('status').eq('id', id).single();
    if (e0) throw new Error(e0.message);
    if (cur.status !== 'draft') throw new Error('Confirmed deliveries cannot be edited. Undo the confirmation first.');
    const { error } = await db.from('pr_deliveries').update({ supplier_id: input.supplier_id, date: input.date, invoice_no: input.invoice_no, delivery_fee_cents: input.delivery_fee_cents, notes: input.notes, updated_at: now, ...(input.file_path ? { file_path: input.file_path, source: input.source ?? 'upload' } : {}) }).eq('id', id);
    if (error) throw new Error(error.message);
    const { error: e2 } = await db.from('pr_delivery_lines').delete().eq('delivery_id', id);
    if (e2) throw new Error(e2.message);
  } else {
    const { data, error } = await db.from('pr_deliveries').insert({ supplier_id: input.supplier_id, date: input.date, invoice_no: input.invoice_no, delivery_fee_cents: input.delivery_fee_cents, notes: input.notes, status: 'draft', source: input.file_path ? (input.source ?? 'upload') : 'manual', file_path: input.file_path ?? null }).select('id').single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  if (input.lines.length) {
    const { error } = await db.from('pr_delivery_lines').insert(input.lines.map((l, i) => ({ delivery_id: id, position: i, ingredient_id: l.ingredient_id, item_text: l.item_text, qty: l.qty, pack_amount: l.pack_amount, price_cents: l.price_cents, bbf: l.bbf })));
    if (error) throw new Error(error.message);
  }
  return id!;
}

/** Confirm: book one purchase per line into the ledger, remember supplier items, mark confirmed. Idempotent per line. */
export async function confirmDelivery(db: DB, id: string): Promise<void> {
  const raw = await loadStockRaw(db);
  const d = raw.deliveries.find((x) => x.id === id);
  if (!d) throw new Error('Delivery not found.');
  if (d.lines.length === 0) throw new Error('A delivery needs at least one line.');
  if (d.lines.some((l) => !l.ingredient_id)) throw new Error('Every line needs an ingredient.');
  const now = new Date().toISOString();
  // delete + insert instead of upsert: the purchase uniqueness is a partial index, which ON CONFLICT cannot infer
  const { error: e0 } = await db.from('pr_stock_ledger').delete().eq('kind', 'purchase').in('ref_id', d.lines.map((l) => l.id!));
  if (e0) throw new Error(e0.message);
  const { error } = await db.from('pr_stock_ledger').insert(
    d.lines.map((l) => ({ ingredient_id: l.ingredient_id, date: d.date, kind: 'purchase', amount: l.amount, ref_type: 'delivery_line', ref_id: l.id, note: l.item_text })),
  );
  if (error) throw new Error(error.message);
  if (d.supplier_id) {
    // one remembered entry per supplier + ingredient: two lines on the same ingredient (e.g. two almond
    // products) would otherwise hit "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const byIngredient = new Map<string, (typeof d.lines)[number]>();
    for (const l of d.lines) if (l.ingredient_id && !byIngredient.has(l.ingredient_id)) byIngredient.set(l.ingredient_id, l);
    const { error: e2 } = await db.from('pr_supplier_items').upsert(
      [...byIngredient.values()].map((l) => ({ supplier_id: d.supplier_id, ingredient_id: l.ingredient_id, item_text: l.item_text, pack_amount: l.pack_amount, updated_at: now })),
      { onConflict: 'supplier_id,ingredient_id' },
    );
    if (e2) throw new Error(e2.message);
  }
  const { error: e3 } = await db.from('pr_deliveries').update({ status: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', id);
  if (e3) throw new Error(e3.message);
}

/** Undo a confirmation: remove its purchase bookings, back to draft (prices follow automatically). */
export async function unconfirmDelivery(db: DB, id: string): Promise<void> {
  const { data: lines, error } = await db.from('pr_delivery_lines').select('id').eq('delivery_id', id);
  if (error) throw new Error(error.message);
  if (lines?.length) {
    const { error: e2 } = await db.from('pr_stock_ledger').delete().eq('kind', 'purchase').in('ref_id', lines.map((l) => l.id));
    if (e2) throw new Error(e2.message);
  }
  const { error: e3 } = await db.from('pr_deliveries').update({ status: 'draft', confirmed_at: null, updated_at: new Date().toISOString() }).eq('id', id);
  if (e3) throw new Error(e3.message);
}

/** Book (or re-book) a frozen bake day's consumption: one row per ingredient and day, replaces earlier bookings of that day. */
export async function bookDayConsumption(db: DB, date: string): Promise<number> {
  const { sheet, frozen, data } = await getBakeSheet(db, date);
  if (!frozen) throw new Error('Only a frozen bake day can be booked.');
  const used = dayConsumption(sheet, data);
  const { error: e0 } = await db.from('pr_stock_ledger').delete().eq('kind', 'consumption').eq('date', date);
  if (e0) throw new Error(e0.message);
  const rows = [...used.entries()].filter(([, amt]) => amt > 0).map(([ingredient_id, amt]) => ({ ingredient_id, date, kind: 'consumption', amount: -amt, ref_type: 'bake_day', ref_id: date, note: null }));
  if (rows.length) {
    const { error } = await db.from('pr_stock_ledger').insert(rows);
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await db.from('pr_bake_days').upsert({ date, consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'date' });
  if (e2) throw new Error(e2.message);
  return rows.length;
}

export async function unbookDayConsumption(db: DB, date: string): Promise<void> {
  const { error } = await db.from('pr_stock_ledger').delete().eq('kind', 'consumption').eq('date', date);
  if (error) throw new Error(error.message);
  const { error: e2 } = await db.from('pr_bake_days').update({ consumed_at: null, updated_at: new Date().toISOString() }).eq('date', date);
  if (e2) throw new Error(e2.message);
}
