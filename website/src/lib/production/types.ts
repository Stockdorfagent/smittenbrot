/**
 * Production module (recipes + bake sheet) — shared types.
 *
 * Mirrors the pr_* tables of migration 037. Everything numeric is kept at full
 * precision; the UI rounds to 1 g for display only (spec 1.3 step 6).
 */

export type Unit = 'g' | 'pcs';

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  name_de: string | null;
  /** null = not yet checked (blocks step 1b); [] = none. */
  allergens: string[] | null;
  components_de: string | null;
  /** The ingredient this one is taken from (egg yolk ← egg). */
  derived_from: string | null;
  /** Grams of this ingredient per one unit of the source (yolk: 17 g per egg). */
  g_per_source_unit: number | null;
  notes: string | null;
  /** Step 4: counted in stock (false for fresh/homemade things that are only priced). */
  track_stock: boolean;
  /** Best-before date asked on deliveries and warned about (flours, nuts, seeds, dried fruit, herbs). */
  track_bbf: boolean;
  /** Red on the stock page below this (ingredient unit); null = no level set. */
  reorder_level: number | null;
}

export interface StarterStage {
  id?: string;
  stage_no: number;        // 1 = last refresh before the bake
  day_offset: number;      // relative to the bake day, e.g. -1
  flour_parts: number;
  water_parts: number;
  seed_parts: number;
  flour_from_recipe: boolean;
}

export interface Starter {
  id: string;
  name: string;
  maintenance_flour_ingredient_id: string | null;
  stages: StarterStage[];
}

export type RecipeItemType = 'ingredient' | 'sub' | 'starter';

export interface RecipeItem {
  id: string;
  position: number;
  type: RecipeItemType;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  starter_id: string | null;
  final_flour_ingredient_id: string | null;
  pct: number;
  label: string | null;
}

export interface PerBatchItem {
  ingredient_id: string;
  amount: number; // in the ingredient's unit, once per actual batch
}

export interface Recipe {
  id: string;
  name: string;
  kind: 'dough' | 'sub';
  base_ingredient_id: string | null;
  dough_margin_factor: number | null;
  build_margin_pct: number | null;
  max_batch_g: number | null;
  per_batch_items: PerBatchItem[];
  current_version: number;
  notes: string | null;
  items: RecipeItem[];
}

export interface ExtraItem {
  ingredient_id: string;
  grams: number; // per piece
}

export interface ProductLink {
  id: string;
  product_id: string | null;
  name: string;
  channel: 'web' | 'intern';
  recipe_id: string | null;
  dough_per_unit_g: number;
  bake_loss_pct: number | null;
  extras: ExtraItem[];
  production: 'orders' | 'stock';
  pieces_per_unit: number | null;
  pieces_from_shop: boolean;    // pieces follow the shop's unit label ("10 Stück") until the owner overrides them
  link_status: 'linked' | 'pending' | 'internal';
  /** Step 3: net price on the B2B price list (Lumbono), per unit sold; null = not sold B2B. */
  b2b_net_price_cents: number | null;
}

export interface Settings {
  dough_margin_factor: number;
  build_margin_pct: number;
  final_build_margin_pct: number;
}

/** One quantity of one product on a bake day. */
export interface Demand {
  pr_product_id: string | null;   // null = no production product for this shop product
  product_name: string;
  qty: number;
  /** web = shop orders; b2b = standing/one-off B2B; manual = market/test/own; extra = made for the freezer. */
  source: 'web' | 'b2b' | 'manual' | 'extra';
  reason?: string | null;
}

/** One-off percentage override for one bake day only. */
export interface Adjustment {
  recipe_id: string;
  item_id: string;
  pct: number;
}

export interface ProductionData {
  ingredients: Ingredient[];
  starters: Starter[];
  recipes: Recipe[];
  products: ProductLink[];
  settings: Settings;
}

// ---------- engine output ----------

export interface Warning {
  type: 'missing_recipe' | 'missing_weight' | 'batch_split' | 'unknown_item' | 'circular' | 'pending_link' | 'zero_sum';
  text: string;
  product_name?: string;
  pr_product_id?: string;       // missing_recipe / missing_weight: deep link to the product's edit form
  qty?: number;
  recipe_id?: string;
}

export interface GramLine {
  item_id: string | null;
  label: string;                // display label: ingredient name (+ step label)
  ingredient_id: string | null;
  ingredient_name: string;
  unit: Unit;
  pct: number | null;
  grams: number;                // per batch, full precision
  adjusted?: boolean;           // one-off adjustment applied today
  original_pct?: number | null;
  /** Derived ingredients (egg yolk): whole source units needed and the by-product that comes with them. */
  source_units?: number;        // exact (grams / g_per_source_unit)
  source_units_rounded?: number; // ceil
  source_name?: string;
  byproduct?: { ingredient_id: string; ingredient_name: string; grams: number } | null;
}

export interface StarterNeed {
  starter_id: string;
  starter_name: string;
  item_id: string;
  label: string;
  in_dough_g: number;           // what the dough / sub needs
  final_build_g: number;        // × (1 + final_build_margin_pct)
  flour_ingredient_id: string | null;
  flour_ingredient_name: string;
  flour_g: number;
  water_g: number;
  seed_g: number;
}

export interface SubBlock {
  recipe_id: string;
  name: string;
  version: number;
  item_id: string | null;       // the parent's line this pre-dough sits on
  pct: number;                  // the parent's line percentage (so the parent's rows add up to its total)
  needed_g: number;             // what the parent needs (before margin)
  build_margin_pct: number;
  total_g: number;              // needed × (1 + margin)
  sum_pct: number;
  factor: number;
  lines: GramLine[];
  subs: SubBlock[];
  starters: StarterNeed[];
}

export interface ProductQty {
  pr_product_id: string;
  name: string;
  qty: number;                  // all sources
  by_source: { source: Demand['source']; qty: number; reason?: string | null }[];
  dough_per_unit_g: number;
  dough_g: number;
}

export interface ExtrasBlock {
  pr_product_id: string;
  product_name: string;
  qty: number;
  lines: { ingredient_id: string; ingredient_name: string; unit: Unit; per_piece: number; total: number }[];
}

export interface RecipeBlock {
  recipe_id: string;
  name: string;
  version: number;
  products: ProductQty[];
  total_dough_g: number;        // Σ qty × dough_per_unit, all batches
  sum_pct: number;
  dough_margin_factor: number;
  margin_g_per_batch: number;   // dough_margin_factor × Σpct
  batches: number;              // 1 unless max_batch_g forces a split
  max_batch_g: number | null;
  per_batch_dough_g: number;    // total_dough / batches
  factor: number;               // per batch: per_batch_dough / Σpct + margin factor
  batch_total_g: number;        // Σpct × factor (dough incl. margin) per batch
  lines: GramLine[];            // per batch
  subs: SubBlock[];             // per batch
  starters: StarterNeed[];      // per batch, incl. those inside subs
  per_batch_items: { ingredient_id: string; ingredient_name: string; unit: Unit; amount: number }[];
  extras: ExtrasBlock[];
  eggs_per_batch: number;       // whole eggs: derived lines + per-batch eggs
  adjustments_applied: number;
}

export interface StarterStageRow {
  stage_no: number;
  day_offset: number;
  date: string;                 // YYYY-MM-DD
  total_g: number;
  flour_g: number;
  water_g: number;
  seed_g: number;
  flour_ingredient_id: string | null;
  flour_ingredient_name: string;
  /** Stage 1 only: one row per recipe (the flour may differ per recipe). */
  per_recipe?: { recipe_name: string; total_g: number; flour_g: number; water_g: number; seed_g: number; flour_ingredient_name: string }[];
}

export interface StarterSchedule {
  starter_id: string;
  name: string;
  stages: StarterStageRow[];    // stage 1 (last refresh) first
  seed_from_kept_g: number;     // what the first stage takes from the kept starter
}

export interface StockProductLine {
  pr_product_id: string;
  name: string;
  qty: number;
  pieces_per_unit: number | null;
  pieces: number | null;
  recipe_id: string | null;
  recipe_name: string | null;
  extras: ExtrasBlock | null;
}

export interface BakeSheet {
  date: string;
  warnings: Warning[];
  products: ProductQty[];       // orders-production products (web + extras + manual)
  stock_products: StockProductLine[];
  recipes: RecipeBlock[];
  starters: StarterSchedule[];
  totals: { eggs: number };
  versions: Record<string, number>; // recipe_id → version used
}

// ---------- step 2: B2B ----------

export interface B2BClient { id: string; name: string; notes: string | null; active: boolean }
export interface OrderItem { pr_product_id: string; qty: number }
export interface StandingOrder { id: string; client_id: string; weekday: number; items: OrderItem[]; valid_from: string | null; valid_to: string | null; active: boolean; notes: string | null }
export interface DayOverride { id: string; client_id: string; date: string; skip: boolean; items: OrderItem[] | null; note: string | null }
export type ManualOrderType = 'b2b' | 'market' | 'test' | 'own';
export interface ManualOrder { id: string; date: string; type: ManualOrderType; client_id: string | null; label: string | null; items: OrderItem[]; notes: string | null }

// ---------- steps 3 + 4: deliveries, stock, costs ----------

export interface Supplier { id: string; name: string; notes: string | null }
export interface DeliveryLine {
  id?: string;
  position: number;
  ingredient_id: string | null;
  item_text: string | null;
  qty: number;                  // packs
  pack_amount: number;          // g or pcs per pack
  amount: number;               // qty × pack_amount
  price_cents: number;          // net, whole line
  bbf: string | null;           // YYYY-MM-DD
}
export interface Delivery {
  id: string;
  supplier_id: string | null;
  date: string;
  invoice_no: string | null;
  delivery_fee_cents: number;
  status: 'draft' | 'confirmed';
  source: 'manual' | 'upload' | 'email';
  notes: string | null;
  confirmed_at: string | null;
  lines: DeliveryLine[];
}
export interface SupplierItem { supplier_id: string; ingredient_id: string; item_text: string | null; pack_amount: number }
export type LedgerKind = 'purchase' | 'consumption' | 'count' | 'manual';
export interface LedgerRow { id: string; ingredient_id: string; date: string; kind: LedgerKind; amount: number; ref_type: string | null; ref_id: string | null; note: string | null; created_at: string }
