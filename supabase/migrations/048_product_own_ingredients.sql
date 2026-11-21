-- 048: B2B-only product baked from the client's ingredients (owner 21.11.2026: Lumbono hazelnut
-- cookies + quiches). On the bake sheet so it is not forgotten; nothing from stock, no ingredient
-- cost; recipe and raw mass optional. Complements 047 (per-client flag) — the per-product flag is
-- the one that fits Lumbono, whose other orders use Sophia's ingredients.
alter table public.pr_products add column if not exists own_ingredients boolean not null default false;
comment on column public.pr_products.own_ingredients is 'Baked from the B2B client''s ingredients: listed, not stocked, not costed.';
