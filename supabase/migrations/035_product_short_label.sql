-- 035: products.short_label — one word for the section heading summary (owner, 29.09.2026):
-- "Diese Woche · Dinkel, Ciabatta". Distinct values of the products currently shown in a section, in the order
-- of the products; variants share one word (both Ciabatte → "Ciabatta"). NULL = product not mentioned.
alter table public.products add column if not exists short_label text;
comment on column public.products.short_label is 'Word for the section-heading summary ("Diese Woche · Dinkel, Ciabatta"); NULL = not listed.';
update public.products set short_label = 'Roggen'   where slug = 'rye-wheat-sourdough'     and short_label is null;
update public.products set short_label = 'Baguette' where slug = 'baguette'                and short_label is null;
update public.products set short_label = 'Dinkel'   where slug = 'spelt-sourdough'         and short_label is null;
update public.products set short_label = 'Ciabatta' where slug in ('ciabatta-naturale','ciabatta-olive-origano') and short_label is null;
