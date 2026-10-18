-- 039: Production step 2 — freezer counter for stock products (Baby-Brioche, Amaretti balls).
-- Owner 18.10.2026: baby brioches are baked 6 at a time with a Wednesday brioche bake and frozen;
-- 2 in stock, Saturday 24.10. takes 2, so Wednesday 21.10. must bake 6 new ones. The sheet should say so.
-- Counter = sum of movements (ledger): +batch (confirmed on the bake sheet), -usage (booked when the day is frozen),
-- count (correction to a counted figure), manual. Units = pieces (balls for amaretti, pieces for baby brioche).

create table if not exists public.pr_freezer_settings (
  pr_product_id uuid primary key references public.pr_products(id) on delete cascade,
  batch_size numeric not null default 1 check (batch_size > 0),   -- pieces per batch (baby brioche 6, amaretti 26)
  min_level numeric not null default 0 check (min_level >= 0),    -- projected stock below this → "make a batch"
  max_age_days int,                                               -- amaretti balls 28 days
  updated_at timestamptz not null default now()
);

create table if not exists public.pr_freezer_movements (
  id uuid primary key default gen_random_uuid(),
  pr_product_id uuid not null references public.pr_products(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('batch', 'usage', 'count', 'manual')),
  qty numeric not null,                 -- signed: +batch, -usage, ± count/manual
  note text,
  created_at timestamptz not null default now()
);
create index if not exists pr_freezer_movements_product_idx on public.pr_freezer_movements (pr_product_id, date);
-- one batch confirmation and one usage booking per product and day (both are idempotent upserts)
create unique index if not exists pr_freezer_movements_day_uniq on public.pr_freezer_movements (pr_product_id, date, kind) where kind in ('batch', 'usage');

do $$
declare t text;
begin
  foreach t in array array['pr_freezer_settings','pr_freezer_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
  end loop;
end $$;
