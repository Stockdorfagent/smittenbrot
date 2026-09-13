-- 028: readable product URLs. products.slug (unique) is generated from the name
-- when missing; the website links /products/<slug> and redirects old /products/<uuid>.
create or replace function public.slugify(txt text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(txt,'')), 'äöüß&', 'aous '),   -- ä→a ö→o ü→u ß→s &→space
    '[^a-z0-9]+', '-', 'g'))
$$;

alter table public.products add column if not exists slug text;

create or replace function public.products_set_slug() returns trigger language plpgsql as $$
declare base text; candidate text; n int := 1;
begin
  if new.slug is null or new.slug = '' then
    base := public.slugify(new.name);
    if base = '' then base := 'produkt'; end if;
    candidate := base;
    while exists (select 1 from public.products p where p.slug = candidate and p.id <> new.id) loop
      n := n + 1; candidate := base || '-' || n;
    end loop;
    new.slug := candidate;
  else
    new.slug := public.slugify(new.slug);
  end if;
  return new;
end $$;

drop trigger if exists trg_products_set_slug on public.products;
create trigger trg_products_set_slug before insert or update of name, slug on public.products
  for each row execute function public.products_set_slug();

-- backfill (fires the trigger row by row so collisions get -2, -3 …)
update public.products set slug = null where slug is null or slug = '';

create unique index if not exists products_slug_key on public.products (slug);
