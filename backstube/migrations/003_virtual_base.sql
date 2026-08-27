-- Migration 003 — a block's 100 % base may be the dough itself.
--
-- Tourte de meule's Zadenmelange block reads:  Deeg 100 | Zadenmelange 14 | Water 9
-- "Deeg" is not an ingredient, not another block and not a starter — it is the
-- dough of the output this block belongs to. Migration 001 required exactly one
-- target per item, which made that row impossible to store.
--
-- New rule: exactly one target, OR none when is_base = true (a virtual base
-- meaning "the scope that referenced this block").
ALTER TABLE public.bs_block_items
  DROP CONSTRAINT IF EXISTS bs_block_items_one_target;
ALTER TABLE public.bs_block_items
  ADD CONSTRAINT bs_block_items_one_target CHECK (
    (   (ingredient_id IS NOT NULL)::int
      + (block_ref_id  IS NOT NULL)::int
      + (starter_id    IS NOT NULL)::int = 1 )
    OR
    (   is_base
      AND ingredient_id IS NULL
      AND block_ref_id  IS NULL
      AND starter_id    IS NULL )
  );
