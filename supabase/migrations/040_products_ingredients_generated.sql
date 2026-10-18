-- 040: Step 1b — generated customer ingredient lists (SPEC §1b, owner decisions 18.10.2026).
-- products.ingredients_generated: approved text WITH **…** markers (website renders bold).
-- products.ingredients (legacy, read by app 1.0.7): filled from it WITHOUT asterisks, allergen part in CAPITALS.
-- products.allergens: the generated allergen list (Annex II categories, wheat/spelt wording).
-- ingredients_status: 'generated' (approved from the recipes) | 'manual' (owner overrides by hand) | NULL (never approved).
alter table public.products add column if not exists ingredients_generated text;
alter table public.products add column if not exists ingredients_status text check (ingredients_status in ('generated', 'manual'));
alter table public.products add column if not exists ingredients_approved_at timestamptz;
comment on column public.products.ingredients_generated is 'Approved ingredient list generated from the recipes, **…** = allergen emphasis (step 1b).';
comment on column public.products.ingredients_status is 'generated = approved from recipes; manual = owner-written override; NULL = never approved.';
