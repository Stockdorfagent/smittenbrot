-- 046: products.available_from — "wieder ab": the product is not offered for pickup dates BEFORE this
-- date (owner, 20.11.2026: 02.12. is a yeast-only bake day after the Schließzeit, sourdough comes back 05.12.).
-- NULL = no restriction. Read by the shop/app lists, the cart, create-payment-intent (both) and the
-- subscription engine's basket (an Abo gets the available part of its basket on such a day).
-- A plain date, no automation: once the date is reached the product is simply offered again.
alter table public.products add column if not exists available_from date;
comment on column public.products.available_from is 'Not offered for pickup dates before this date ("wieder ab"). NULL = always.';
