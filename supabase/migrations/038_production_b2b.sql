-- 038: Production module step 2 (B2B): clients, standing orders per weekday, per-date overrides, one-off orders.
-- Owner request 18.10.2026: Lumbono standing orders (Wed: 10 pizza dough balls + 2 Focaccia Lumbono;
-- Sat: 2 Focaccia Lumbono + 2 Baby-Brioche + 3 Frühstückssemmeln), changeable per date, skippable when closed,
-- a second B2B client may follow. All tables pr_-prefixed, RLS is_admin(), nothing in the shop touched.

create table if not exists public.pr_b2b_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per client per weekday (0 = Sunday … 6 = Saturday). items = [{pr_product_id, qty}].
create table if not exists public.pr_standing_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pr_b2b_clients(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  items jsonb not null default '[]'::jsonb,
  valid_from date,
  valid_to date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, weekday)
);

-- A change for ONE date: either skip (client closed / nothing wanted) or a replacement item list.
create table if not exists public.pr_b2b_day_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pr_b2b_clients(id) on delete cascade,
  date date not null,
  skip boolean not null default false,
  items jsonb,                       -- NULL = keep the standing items (only meaningful with skip); else the full list for this date
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date)
);

-- One-off orders that are not web orders: a B2B extra, the market, a test bake, own use.
create table if not exists public.pr_manual_orders (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  type text not null check (type in ('b2b', 'market', 'test', 'own')),
  client_id uuid references public.pr_b2b_clients(id) on delete set null,
  label text,
  items jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pr_manual_orders_date_idx on public.pr_manual_orders (date);
create index if not exists pr_b2b_day_overrides_date_idx on public.pr_b2b_day_overrides (date);

do $$
declare t text;
begin
  foreach t in array array['pr_b2b_clients','pr_standing_orders','pr_b2b_day_overrides','pr_manual_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
  end loop;
end $$;
