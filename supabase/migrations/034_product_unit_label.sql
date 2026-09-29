-- 034: products.unit_label — what one price buys, shown next to the price (owner, 29.09.2026).
-- e.g. Amaretti: price 3,00 € with unit_label '5 Stück' → "3,00 € / 5 Stück". NULL = per piece, nothing shown.
-- Display only; it does not change any calculation (the price stays the unit price of one cart line).
alter table public.products add column if not exists unit_label text;
comment on column public.products.unit_label is 'Shown next to the price, e.g. "5 Stück" → "3,00 € / 5 Stück". NULL = per piece (nothing shown).';
update public.products set unit_label = '5 Stück' where slug = 'amaretti-classici' and unit_label is null;
