-- 049: recipe steps (owner 21.11.2026): method rows + planning table per recipe, imported from
-- her Excel files (recipe-steps/*.xlsx) or edited on the recipe page; printed on the Backplan and
-- the basis for the later bake-day planner. JSON {method:[{label,value,detail}], planning:[{task,duration,min_minutes,max_minutes,hands_free}]}.
alter table public.pr_recipes add column if not exists steps jsonb not null default '{"method":[],"planning":[]}'::jsonb;
comment on column public.pr_recipes.steps is 'Method + planning rows (lib/production/recipeSteps.ts); saved apart from the versioned lines.';
