-- 044: In-house batches (owner, 30.10.2026) — vanilla sugar, lemon sugar, espresso syrup,
-- roasted sourdough: ingredients MADE from a recipe in a batch ahead of time and used over
-- weeks, also outside production. Not a sub-recipe (that is computed fresh per bake day).
-- "Make batch" on Production → Stock books the components out of the ledger, the made
-- ingredient in, and prices the ingredient from the component prices (goods and delivery
-- share kept apart, like deliveries). Deleting the batch undoes everything.

alter table public.pr_ingredients add column if not exists made_from_recipe_id uuid references public.pr_recipes(id) on delete set null;

create table if not exists public.pr_batches (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.pr_ingredients(id) on delete cascade,
  recipe_id uuid references public.pr_recipes(id) on delete set null,
  date date not null,
  amount numeric not null check (amount > 0),       -- made, in the ingredient's unit
  goods_cents integer not null default 0 check (goods_cents >= 0),      -- Σ components × goods price
  delivery_cents integer not null default 0 check (delivery_cents >= 0), -- Σ components × delivery share
  lines jsonb not null default '[]'::jsonb,         -- [{ingredient_id, amount, goods_cents, delivery_cents}] snapshot at booking
  note text,
  created_at timestamptz not null default now()
);
create index if not exists pr_batches_ingredient_idx on public.pr_batches (ingredient_id, date desc);

alter table public.pr_stock_ledger drop constraint if exists pr_stock_ledger_kind_check;
alter table public.pr_stock_ledger add constraint pr_stock_ledger_kind_check check (kind in ('purchase','consumption','count','manual','batch'));

alter table public.pr_batches enable row level security;
drop policy if exists pr_batches_admin_all on public.pr_batches;
create policy pr_batches_admin_all on public.pr_batches for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.pr_batches to anon, authenticated, service_role;
