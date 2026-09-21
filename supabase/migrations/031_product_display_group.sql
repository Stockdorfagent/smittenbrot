-- 031: products.display_group — WHERE an available product is shown on the /products shop page
-- (owner, 21.09.2026). It never decides WHETHER a product is available: that stays with
-- active / cycle / available_wed / available_sat / capacity.
--   classic → "Klassiker"                (the weekly staples)
--   weekly  → "Diese Woche"              (the rotating breads; the A/B cycle is never shown to customers)
--   special → "Extras"                   (Panettone, Osterhase …; section hidden when nothing is available;
--                                         never part of a Dauerbestellung → subscribable must be false)
alter table public.products
  add column if not exists display_group text not null default 'classic'
  check (display_group in ('classic', 'weekly', 'special'));

-- Backfill from the existing data: rotating breads are "weekly", the Osterhase is "special".
update public.products set display_group = 'weekly'  where cycle in ('week_a', 'week_b');
update public.products set display_group = 'special', subscribable = false where slug = 'osterhase';

-- Specials can never be subscribed: the Abo flows filter on subscribable=true, so this one rule
-- keeps them out of every Dauerbestellung without touching the flows.
alter table public.products drop constraint if exists products_special_not_subscribable;
alter table public.products add constraint products_special_not_subscribable
  check (display_group <> 'special' or subscribable = false);

comment on column public.products.display_group is
  'Shop section on /products: classic | weekly | special. Display only; availability is decided elsewhere. special ⇒ subscribable=false (constraint).';
