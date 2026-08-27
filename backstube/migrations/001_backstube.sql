-- ═══════════════════════════════════════════════════════════════════
-- Smittenbrot Backstube — internal baker tool
-- Migration 001: full schema (P0 UI + P1/P2 tables created up front)
--
-- ALL tables are prefixed bs_ and live in `public`.
-- ALL are RLS-locked to is_admin() — invisible to the app and the shop.
-- NOTHING in this migration alters an existing table, view, publication
-- or policy. It is purely additive.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Settings (single row) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vat_registered      BOOLEAN NOT NULL DEFAULT true,
  mix_at_wed          TIME NOT NULL DEFAULT '04:00',
  mix_at_sat          TIME NOT NULL DEFAULT '04:00',
  mhd_warn_days       INTEGER NOT NULL DEFAULT 14,
  reorder_buffer_days INTEGER NOT NULL DEFAULT 3,
  alert_email         TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.bs_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Suppliers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  order_email     TEXT,
  lead_days       INTEGER NOT NULL DEFAULT 3,
  min_order_cents INTEGER,
  notes           TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Ingredients ───────────────────────────────────────────────────
-- Everything internal is grams / millilitres. kg + l is display only.
CREATE TABLE IF NOT EXISTS public.bs_ingredients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL UNIQUE,
  base_unit          TEXT NOT NULL DEFAULT 'g' CHECK (base_unit IN ('g','ml','pcs')),
  supplier_id        UUID REFERENCES public.bs_suppliers(id) ON DELETE SET NULL,
  -- net price, because input VAT is reclaimable (see plan §9.1)
  price_cents_per_kg NUMERIC(12,4),
  vat_rate           NUMERIC(4,3) NOT NULL DEFAULT 0.070,
  pack_size_g        NUMERIC(12,2),
  reorder_point_g    NUMERIC(12,2),
  allergens          TEXT[] NOT NULL DEFAULT '{}',
  mhd_relevant       BOOLEAN NOT NULL DEFAULT true,
  is_flour           BOOLEAN NOT NULL DEFAULT false,
  -- an ingredient the owner produces himself (e.g. Zadenmelange), plan §14.3
  produced_by_recipe UUID,
  notes              TEXT,
  active             BOOLEAN NOT NULL DEFAULT true,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Containers (reference data, no versioning — plan §15.1) ───────
CREATE TABLE IF NOT EXISTS public.bs_containers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  volume_ml  NUMERIC(12,2),
  max_pieces INTEGER,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Starters (the maintained jars) ────────────────────────────────
-- Parts notation, exactly as the owner works: SL 2:1:1 (=4), LL 2:2:1 (=5).
CREATE TABLE IF NOT EXISTS public.bs_starters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('SL','LL')),
  flour_ingredient_id UUID REFERENCES public.bs_ingredients(id) ON DELETE RESTRICT,
  parts_flour         NUMERIC(8,3) NOT NULL DEFAULT 2,
  parts_water         NUMERIC(8,3) NOT NULL DEFAULT 1,
  parts_seed          NUMERIC(8,3) NOT NULL DEFAULT 1,
  typical_amount_g    NUMERIC(12,2),
  notes               TEXT,
  active              BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Starter build stages (the Desem schema chain) ─────────────────
CREATE TABLE IF NOT EXISTS public.bs_starter_builds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starter_id      UUID NOT NULL REFERENCES public.bs_starters(id) ON DELETE CASCADE,
  stage_no        INTEGER NOT NULL,
  days_before     INTEGER NOT NULL,
  duration_hours  NUMERIC(6,2),
  temp_c          NUMERIC(5,2),
  overage_pct     NUMERIC(6,3) NOT NULL DEFAULT 0,
  UNIQUE (starter_id, stage_no)
);

-- ─── Recipes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_recipes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL UNIQUE,      -- the Excel sheet name
  smittenbrot_name      TEXT,                      -- cell A2 / a_OVERZICHT col H
  source                TEXT,
  source_page           TEXT,
  -- levain safety margin, expressed in LOAVES, levain only (plan §6.4)
  levain_safety_units   NUMERIC(6,2) NOT NULL DEFAULT 0,
  target_dough_temp_c   NUMERIC(5,2),
  delta_t               NUMERIC(5,2),
  is_experimental        BOOLEAN NOT NULL DEFAULT false,
  active                BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  -- increments on save, so a bake-day snapshot can be labelled (plan §15.2)
  version               INTEGER NOT NULL DEFAULT 1,
  -- set when the recipe produces a stock ingredient, not a sellable product
  output_ingredient_id  UUID REFERENCES public.bs_ingredients(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Recipe outputs — several products from ONE dough (plan §3.35) ─
CREATE TABLE IF NOT EXISTS public.bs_recipe_outputs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       UUID NOT NULL REFERENCES public.bs_recipes(id) ON DELETE CASCADE,
  -- NULL for wholesale-only items that have no row in products
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  output_name     TEXT NOT NULL,
  -- the three linked weights: dough = baked / (1 - loss).  Edit any two.
  piece_weight_g  NUMERIC(12,2),                   -- Deeggewicht/st.
  target_baked_g  NUMERIC(12,2),
  baking_loss_pct NUMERIC(6,3),
  -- the owner's Factor bump, re-expressed in GRAMS (plan §6.5)
  loss_g          NUMERIC(12,2) NOT NULL DEFAULT 0,
  loss_pct        NUMERIC(6,3)  NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ─── Recipe blocks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_recipe_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   UUID NOT NULL REFERENCES public.bs_recipes(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  -- the owner's per-block x1.1 / x1.03  (stored as 10 / 3)
  overage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  -- non-NULL = this block applies to ONE output only (e.g. Zadenmelange)
  output_id   UUID REFERENCES public.bs_recipe_outputs(id) ON DELETE CASCADE,
  is_final    BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT
);

-- ─── Block items ───────────────────────────────────────────────────
-- Percentages are relative to THIS BLOCK's base (is_base), which is often
-- not flour — in Tourte de meule's final block the base is the Autolysedeeg.
CREATE TABLE IF NOT EXISTS public.bs_block_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id      UUID NOT NULL REFERENCES public.bs_recipe_blocks(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  ingredient_id UUID REFERENCES public.bs_ingredients(id)     ON DELETE RESTRICT,
  block_ref_id  UUID REFERENCES public.bs_recipe_blocks(id)   ON DELETE RESTRICT,
  starter_id    UUID REFERENCES public.bs_starters(id)        ON DELETE RESTRICT,
  percent       NUMERIC(12,4) NOT NULL DEFAULT 0,
  mode          TEXT NOT NULL DEFAULT 'percent'
                CHECK (mode IN ('percent','per_unit_g','per_batch_g')),
  is_base       BOOLEAN NOT NULL DEFAULT false,
  note          TEXT,
  -- exactly one target
  CONSTRAINT bs_block_items_one_target CHECK (
    (ingredient_id IS NOT NULL)::int
  + (block_ref_id  IS NOT NULL)::int
  + (starter_id    IS NOT NULL)::int = 1
  )
);

-- ─── Recipe notes: dated, append-only log (plan §15.3) ─────────────
CREATE TABLE IF NOT EXISTS public.bs_recipe_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id  UUID NOT NULL REFERENCES public.bs_recipes(id) ON DELETE CASCADE,
  noted_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Wholesale (Lumbono) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_wholesale_customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  prices_net BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- standing We / Sa order, loaded as the default each week
CREATE TABLE IF NOT EXISTS public.bs_wholesale_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.bs_wholesale_customers(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  output_id   UUID NOT NULL REFERENCES public.bs_recipe_outputs(id) ON DELETE CASCADE,
  qty         NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_cents INTEGER,
  UNIQUE (customer_id, weekday, output_id)
);

CREATE TABLE IF NOT EXISTS public.bs_wholesale_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.bs_wholesale_customers(id) ON DELETE CASCADE,
  bake_date   DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, bake_date)
);

CREATE TABLE IF NOT EXISTS public.bs_wholesale_order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES public.bs_wholesale_orders(id) ON DELETE CASCADE,
  output_id   UUID NOT NULL REFERENCES public.bs_recipe_outputs(id) ON DELETE RESTRICT,
  qty         NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_cents INTEGER
);

-- ─── Bake days ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_bake_days (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bake_date  DATE NOT NULL UNIQUE,
  mix_at     TIMESTAMPTZ,
  room_temp_c NUMERIC(5,2),
  flour_temp_c NUMERIC(5,2),
  locked_at  TIMESTAMPTZ,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bs_bake_day_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bake_day_id   UUID NOT NULL REFERENCES public.bs_bake_days(id) ON DELETE CASCADE,
  output_id     UUID NOT NULL REFERENCES public.bs_recipe_outputs(id) ON DELETE CASCADE,
  -- which recipe was chosen, where a product has alternatives (plan §13.2)
  recipe_id     UUID REFERENCES public.bs_recipes(id) ON DELETE SET NULL,
  backup_units  NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  UNIQUE (bake_day_id, output_id)
);

-- frozen at cutoff: the numbers AND the parameters that produced them
CREATE TABLE IF NOT EXISTS public.bs_bake_day_demand (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bake_day_id   UUID NOT NULL REFERENCES public.bs_bake_days(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES public.bs_ingredients(id) ON DELETE SET NULL,
  ingredient_name TEXT NOT NULL,
  qty_g         NUMERIC(14,3) NOT NULL,
  cost_cents    NUMERIC(14,4),
  frozen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bs_bake_day_snapshot (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bake_day_id UUID NOT NULL REFERENCES public.bs_bake_days(id) ON DELETE CASCADE,
  recipe_id   UUID REFERENCES public.bs_recipes(id) ON DELETE SET NULL,
  recipe_name TEXT,
  version     INTEGER,
  payload     JSONB NOT NULL,
  frozen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Stock (P1: tables now, UI later) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.bs_deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  UUID REFERENCES public.bs_suppliers(id) ON DELETE SET NULL,
  delivered_on DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_ref  TEXT,
  total_cents  INTEGER,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row = one LOT. MHD lives here, FIFO consumes by best_before.
CREATE TABLE IF NOT EXISTS public.bs_delivery_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       UUID NOT NULL REFERENCES public.bs_deliveries(id) ON DELETE CASCADE,
  ingredient_id     UUID NOT NULL REFERENCES public.bs_ingredients(id) ON DELETE RESTRICT,
  pack_count        NUMERIC(10,2) NOT NULL DEFAULT 1,
  pack_size_g       NUMERIC(12,2) NOT NULL,
  qty_g             NUMERIC(14,3) NOT NULL,
  price_cents_net   NUMERIC(12,2),
  price_cents_gross NUMERIC(12,2),
  vat_rate          NUMERIC(4,3),
  best_before       DATE,
  lot_code          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bs_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_item_id UUID REFERENCES public.bs_delivery_items(id) ON DELETE SET NULL,
  ingredient_id    UUID NOT NULL REFERENCES public.bs_ingredients(id) ON DELETE RESTRICT,
  type             TEXT NOT NULL CHECK (type IN ('bake','waste','starter_feed','correction')),
  qty_g            NUMERIC(14,3) NOT NULL,
  occurred_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  bake_day_id      UUID REFERENCES public.bs_bake_days(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bs_block_items_block   ON public.bs_block_items(block_id);
CREATE INDEX IF NOT EXISTS idx_bs_blocks_recipe       ON public.bs_recipe_blocks(recipe_id);
CREATE INDEX IF NOT EXISTS idx_bs_outputs_recipe      ON public.bs_recipe_outputs(recipe_id);
CREATE INDEX IF NOT EXISTS idx_bs_outputs_product     ON public.bs_recipe_outputs(product_id);
CREATE INDEX IF NOT EXISTS idx_bs_notes_recipe        ON public.bs_recipe_notes(recipe_id, noted_on DESC);
CREATE INDEX IF NOT EXISTS idx_bs_builds_starter      ON public.bs_starter_builds(starter_id, stage_no);
CREATE INDEX IF NOT EXISTS idx_bs_delitems_ing        ON public.bs_delivery_items(ingredient_id, best_before);
CREATE INDEX IF NOT EXISTS idx_bs_movements_lot       ON public.bs_movements(delivery_item_id);
CREATE INDEX IF NOT EXISTS idx_bs_movements_ing       ON public.bs_movements(ingredient_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_bs_bakeday_date        ON public.bs_bake_days(bake_date);
CREATE INDEX IF NOT EXISTS idx_bs_wsorders_date       ON public.bs_wholesale_orders(bake_date);

-- ─── RLS: admin only, on every table ───────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'bs\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_admin_all', t);
  END LOOP;
END $$;
