-- Production ↔ shop products: one flow instead of double work (owner, 27.10.2026).
--
-- 1. A new shop product gets its production row automatically (linked, no recipe,
--    raw mass 0 = "not set yet"), so the bake sheet and the overview can say what
--    is still missing instead of silently ignoring the product (the Baisers case).
-- 2. Pieces per unit follow the shop's unit label ("10 Stück") unless the owner
--    typed a different value on Production → Products (pieces_from_shop = false).
-- 3. The shop name is mirrored into the production row on rename.

alter table public.pr_products drop constraint if exists pr_products_dough_per_unit_g_check;
alter table public.pr_products add constraint pr_products_dough_per_unit_g_check check (dough_per_unit_g >= 0);  -- 0 = not set yet

alter table public.pr_products add column if not exists pieces_from_shop boolean not null default false;

create or replace function public.pr_pieces_from_label(label text)
returns numeric language sql immutable as $$
  select case when label ~* '^\s*(\d+)\s*Stück\s*$' then (substring(label from '(\d+)'))::numeric else null end
$$;

-- Backfill: rows whose pieces equal the shop label are "from the shop".
update public.pr_products p
set pieces_from_shop = true
from public.products s
where s.id = p.product_id
  and p.pieces_per_unit is not null
  and p.pieces_per_unit = public.pr_pieces_from_label(s.unit_label);

create or replace function public.pr_sync_shop_product()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pcs numeric := public.pr_pieces_from_label(new.unit_label);
  pending_id uuid;
begin
  if tg_op = 'INSERT' then
    select id into pending_id from public.pr_products where link_status = 'pending' and name = new.name limit 1;
    if pending_id is not null then
      update public.pr_products
      set product_id = new.id, link_status = 'linked',
          pieces_from_shop = (pieces_per_unit is null and pcs is not null),
          pieces_per_unit = coalesce(pieces_per_unit, pcs),
          updated_at = now()
      where id = pending_id;
    elsif not exists (select 1 from public.pr_products where product_id = new.id) then
      insert into public.pr_products (product_id, name, channel, recipe_id, dough_per_unit_g, production, pieces_per_unit, pieces_from_shop, link_status)
      values (new.id, new.name, 'web', null, 0, 'orders', pcs, pcs is not null, 'linked');
    end if;
  else
    update public.pr_products
    set name = new.name,
        pieces_per_unit = case when pieces_from_shop then pcs else pieces_per_unit end,
        updated_at = now()
    where product_id = new.id
      and (name is distinct from new.name or (pieces_from_shop and pieces_per_unit is distinct from pcs));
  end if;
  return new;
end $$;

drop trigger if exists trg_products_sync_production on public.products;
create trigger trg_products_sync_production
  after insert or update of name, unit_label on public.products
  for each row execute function public.pr_sync_shop_product();

-- Shop products that exist today without a production row (none expected, but be complete).
insert into public.pr_products (product_id, name, channel, recipe_id, dough_per_unit_g, production, pieces_per_unit, pieces_from_shop, link_status)
select s.id, s.name, 'web', null, 0, 'orders', public.pr_pieces_from_label(s.unit_label), public.pr_pieces_from_label(s.unit_label) is not null, 'linked'
from public.products s
where not exists (select 1 from public.pr_products p where p.product_id = s.id)
  and not exists (select 1 from public.pr_products p where p.link_status = 'pending' and p.name = s.name);
