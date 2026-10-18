-- 037: Production module (recipes + bake sheet), step 1 of stock-tracking/SPEC-produktion-lager.md.
-- Owner decision 18.10.2026: lives inside the website admin (/admin/production), replaces the retired Backstube tool.
-- Every table is prefixed pr_ and locked to the admin via RLS (is_admin()); nothing in the shop is altered.
-- Percentages, grams and factors are numeric (full precision); rounding happens only in the UI.

create table if not exists public.pr_settings (
  id int primary key default 1 check (id = 1),
  dough_margin_factor numeric not null default 0.1,
  build_margin_pct numeric not null default 10,
  final_build_margin_pct numeric not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.pr_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.pr_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                       -- internal name, free text (English, Dutch, anything)
  unit text not null default 'g' check (unit in ('g', 'pcs')),
  name_de text,                                    -- customer-facing German name, allergen part marked **…**
  allergens text[],                                -- NULL = not yet checked (blocks step 1b); '{}' = none
  components_de text,                              -- sub-ingredients of a compound ingredient, verbatim
  derived_from uuid references public.pr_ingredients(id) on delete set null,  -- e.g. egg yolk ← egg
  g_per_source_unit numeric,                       -- grams of this per one source unit (yolk 17 g / egg)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pr_starters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  maintenance_flour_ingredient_id uuid references public.pr_ingredients(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Ordered last stage first: stage_no 1 = the final refresh before the bake (day_offset -1).
create table if not exists public.pr_starter_stages (
  id uuid primary key default gen_random_uuid(),
  starter_id uuid not null references public.pr_starters(id) on delete cascade,
  stage_no int not null check (stage_no >= 1),
  day_offset int not null,
  flour_parts numeric not null check (flour_parts > 0),
  water_parts numeric not null check (water_parts >= 0),
  seed_parts numeric not null check (seed_parts > 0),
  flour_from_recipe boolean not null default false,
  unique (starter_id, stage_no)
);

create table if not exists public.pr_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('dough', 'sub')),
  base_ingredient_id uuid references public.pr_ingredients(id) on delete set null,
  dough_margin_factor numeric,                     -- dough only; NULL = settings default
  build_margin_pct numeric,                        -- sub only; NULL = settings default
  max_batch_g numeric,                             -- mixer limit; NULL = no limit
  per_batch_items jsonb not null default '[]'::jsonb,  -- [{ingredient_id, amount}] in the ingredient's unit, once per batch
  current_version int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pr_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.pr_recipes(id) on delete cascade,
  position int not null,
  type text not null check (type in ('ingredient', 'sub', 'starter')),
  ingredient_id uuid references public.pr_ingredients(id) on delete restrict,
  sub_recipe_id uuid references public.pr_recipes(id) on delete restrict,
  starter_id uuid references public.pr_starters(id) on delete restrict,
  final_flour_ingredient_id uuid references public.pr_ingredients(id) on delete set null,
  pct numeric not null check (pct >= 0),
  label text,
  check (
    (type = 'ingredient' and ingredient_id is not null and sub_recipe_id is null and starter_id is null) or
    (type = 'sub' and sub_recipe_id is not null and ingredient_id is null and starter_id is null) or
    (type = 'starter' and starter_id is not null and ingredient_id is null and sub_recipe_id is null)
  )
);
create index if not exists pr_recipe_items_recipe_idx on public.pr_recipe_items (recipe_id, position);

-- Every save of a recipe writes a version; bake-day snapshots name the version they used.
create table if not exists public.pr_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.pr_recipes(id) on delete cascade,
  version_no int not null,
  note text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (recipe_id, version_no)
);

-- One row per product that can be baked: a shop product (product_id set) or an internal B2B product.
create table if not exists public.pr_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid unique references public.products(id) on delete set null,
  name text not null,                              -- shop name at link time, or the internal product's name
  channel text not null check (channel in ('web', 'intern')),
  recipe_id uuid references public.pr_recipes(id) on delete set null,
  dough_per_unit_g numeric not null check (dough_per_unit_g > 0),
  bake_loss_pct numeric,
  extras jsonb not null default '[]'::jsonb,       -- [{ingredient_id, grams}] per piece, outside the dough
  production text not null default 'orders' check (production in ('orders', 'stock')),
  pieces_per_unit numeric,                         -- e.g. 5 balls per bag of amaretti (from the shop's unit_label)
  link_status text not null check (link_status in ('linked', 'pending', 'internal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pr_bake_days (
  date date primary key,
  extra_quantities jsonb not null default '[]'::jsonb,  -- [{pr_product_id, qty, reason}]
  adjustments jsonb not null default '[]'::jsonb,       -- [{recipe_id, item_id, pct}] one-off, this day only
  notes text,
  snapshot jsonb,                                       -- the computed sheet, frozen after the bake day
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: admin only, the same guard the shop's admin tables use.
do $$
declare t text;
begin
  foreach t in array array['pr_settings','pr_ingredients','pr_starters','pr_starter_stages','pr_recipes',
                           'pr_recipe_items','pr_recipe_versions','pr_products','pr_bake_days'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
  end loop;
end $$;
