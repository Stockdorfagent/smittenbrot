-- 036: retire the Backstube tool (owner decision 18.10.2026).
-- Replaced by the production module inside the website admin (/admin/production).
-- Data dump before this drop: backups/backstube-bs-tables-2026-10-18/ (JSON per table + the bs_ migrations),
-- source tarball: backups/backstube-retired-2026-10-18.tar.gz, GitHub repo archived as smittenbrot-backstube-RETIRED.
-- Nothing outside the bs_ prefix is touched.
drop view if exists public.bs_write_off_monthly;
drop view if exists public.bs_write_offs;
drop view if exists public.bs_ingredient_stock;
drop view if exists public.bs_batch_stock;
drop function if exists public.bs_close_bake_day;
drop function if exists public.bs_reopen_bake_day;
drop function if exists public.bs_snapshot_recipe;
drop function if exists public.bs_consume;
drop function if exists public.bs_write_off_batch;
drop table if exists
  public.bs_bake_day_demand, public.bs_bake_day_products, public.bs_bake_day_snapshot, public.bs_bake_days,
  public.bs_batches, public.bs_block_items, public.bs_containers, public.bs_deliveries, public.bs_ingredients,
  public.bs_movements, public.bs_recipe_blocks, public.bs_recipe_notes, public.bs_recipe_outputs, public.bs_recipes,
  public.bs_settings, public.bs_starter_builds, public.bs_starters, public.bs_suppliers, public.bs_wholesale_customers,
  public.bs_wholesale_order_items, public.bs_wholesale_orders, public.bs_wholesale_templates
cascade;
