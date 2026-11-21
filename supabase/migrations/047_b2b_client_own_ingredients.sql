-- 047: B2B client that brings its own ingredients (owner 21.11.2026: café standing orders baked
-- from the client's ingredients). Its orders stay on the bake sheet; booking the day's stock
-- consumption leaves out that client's share of the dough and its extras (stock.ts dayConsumption).
alter table public.pr_b2b_clients add column if not exists own_ingredients boolean not null default false;
comment on column public.pr_b2b_clients.own_ingredients is 'Client supplies the ingredients: baked and listed, but not taken from stock.';
