-- Migration 002 — three refinements the demand engine needs.
--
-- 1) levain_safety_units belongs on the OUTPUT, not the recipe.
--    The owner's Desem schema applies +0.5 / +1 per PRODUCT row
--    (breads +0.5, Baguette / Baby brioche / Frühstückssemmel +1),
--    and one recipe can have several outputs (Stockdorf / Seeded).
ALTER TABLE public.bs_recipe_outputs
  ADD COLUMN IF NOT EXISTS levain_safety_units NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.bs_recipes
  DROP COLUMN IF EXISTS levain_safety_units;

-- 2) When the recipe's own levain block gets built, relative to bake day.
--    Owner's Desem schema for a Wednesday bake:
--      Sun (-3) pre-build  ->  Mon (-2) build the levain
--      Tue (-1) levain into the dough  ->  Wed (0) bake
--    So the levain block is built 2 days before the bake, and each
--    bs_starter_builds row is a PRE-build ahead of that (default 3).
ALTER TABLE public.bs_starters
  ADD COLUMN IF NOT EXISTS build_days_before INTEGER NOT NULL DEFAULT 2;

-- 3) The levain chain consumes water, which must resolve to a real
--    ingredient row rather than being matched by name.
ALTER TABLE public.bs_settings
  ADD COLUMN IF NOT EXISTS water_ingredient_id UUID
    REFERENCES public.bs_ingredients(id) ON DELETE SET NULL;
