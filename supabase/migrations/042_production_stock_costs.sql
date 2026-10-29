-- 042: Production steps 3 + 4 — deliveries, stock ledger, cost prices (owner, 29.10.2026).
-- Deliveries are entered by hand for now (PDF reading / e-mail intake come later and only
-- add a different way to create the same draft). Confirming a delivery books purchases into
-- the stock ledger and makes the line the ingredient's current price. Delivery fees are kept
-- separate from the goods price and spread evenly over the lines of that delivery.
-- Stock = sum of the ledger; a bake day books its consumption once (pr_bake_days.consumed_at).
-- Since 30.10.2026 Supabase no longer grants API access to new tables automatically → explicit grants.

alter table public.pr_ingredients add column if not exists track_stock boolean not null default true;
alter table public.pr_ingredients add column if not exists track_bbf boolean not null default false;
alter table public.pr_ingredients add column if not exists reorder_level numeric check (reorder_level is null or reorder_level >= 0);

-- Owner's rule: best-before for flours, nuts, seeds, dried fruit, herbs (+ starch, cocoa, acerola powder).
update public.pr_ingredients set track_bbf = true
where name in ('Wheat flour T55/550','Wheat flour T80/1050','Spelt flour T65/630','Spelt flour T100/1050','Spelt flour Vollkorn',
  'Rye flour T130/1150','Rye flour T170/Vollkorn','Durum wheat flour','Almond flour','Flaked almonds','Flaxseed','Poppy seed',
  'Sesame','Sesame white','Sesame black','Sunflower seeds','Oregano','Rosemary (dried)','Corn starch','Cocoa powder','Acerola powder');
-- Fresh, homemade and derived things are priced but not counted as stock.
update public.pr_ingredients set track_stock = false
where name in ('Water','Butter','Milk','Egg','Egg white','Egg yolk','Lemon','Mini tomatoes','Espresso syrup (homemade)','Roasted sourdough');

alter table public.pr_products add column if not exists b2b_net_price_cents integer check (b2b_net_price_cents is null or b2b_net_price_cents >= 0);
alter table public.pr_bake_days add column if not exists consumed_at timestamptz;

create table if not exists public.pr_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.pr_deliveries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.pr_suppliers(id) on delete restrict,
  date date not null,
  invoice_no text,
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),  -- net, kept apart from the goods
  status text not null default 'draft' check (status in ('draft','confirmed')),
  source text not null default 'manual' check (source in ('manual','upload','email')),
  file_path text,                                   -- later: the invoice PDF in storage
  notes text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pr_deliveries_date_idx on public.pr_deliveries (date desc);

create table if not exists public.pr_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.pr_deliveries(id) on delete cascade,
  position int not null default 0,
  ingredient_id uuid references public.pr_ingredients(id) on delete restrict,   -- null only while the draft is incomplete
  item_text text,                                   -- the supplier's wording ("Weizenmehl 550 25 kg")
  qty numeric not null default 1 check (qty > 0),   -- packs
  pack_amount numeric not null check (pack_amount > 0),  -- g or pcs per pack (ingredient unit)
  amount numeric generated always as (qty * pack_amount) stored,
  price_cents integer not null default 0 check (price_cents >= 0),  -- net, the whole line
  bbf date,                                         -- best-before, only for track_bbf ingredients
  created_at timestamptz not null default now()
);
create index if not exists pr_delivery_lines_delivery_idx on public.pr_delivery_lines (delivery_id, position);
create index if not exists pr_delivery_lines_ingredient_idx on public.pr_delivery_lines (ingredient_id);

-- Remembered per supplier + ingredient: wording and pack size, prefilled on the next delivery
-- (and the matching key once invoices are read automatically).
create table if not exists public.pr_supplier_items (
  supplier_id uuid not null references public.pr_suppliers(id) on delete cascade,
  ingredient_id uuid not null references public.pr_ingredients(id) on delete cascade,
  item_text text,
  pack_amount numeric not null check (pack_amount > 0),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, ingredient_id)
);

create table if not exists public.pr_stock_ledger (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.pr_ingredients(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('purchase','consumption','count','manual')),
  amount numeric not null,                          -- signed, ingredient unit: +purchase, −consumption, ± count/manual
  ref_type text,                                    -- 'delivery_line' | 'bake_day'
  ref_id text,                                      -- delivery line id | bake day date
  note text,
  created_at timestamptz not null default now()
);
create index if not exists pr_stock_ledger_ingredient_idx on public.pr_stock_ledger (ingredient_id, date);
-- one consumption booking per ingredient and bake day, one purchase per delivery line (idempotent)
create unique index if not exists pr_stock_ledger_consumption_uniq on public.pr_stock_ledger (ingredient_id, date) where kind = 'consumption';
create unique index if not exists pr_stock_ledger_purchase_uniq on public.pr_stock_ledger (ref_id) where kind = 'purchase';

do $$
declare t text;
begin
  foreach t in array array['pr_suppliers','pr_deliveries','pr_delivery_lines','pr_supplier_items','pr_stock_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;
