-- 027: structured product information (Gewicht / Zutaten / Allergene), shown in a
-- uniform block under the description on website + app instead of free text
-- inside the description. The cross-contamination sentence is identical for all
-- products and lives in code (website/src/lib/productInfo.ts, mobile/src/lib/productInfo.ts).
alter table public.products
  add column if not exists weight      text,
  add column if not exists ingredients text,
  add column if not exists allergens   text;
comment on column public.products.weight      is 'e.g. "ca. 330 g" — shown as "Gewicht: …"';
comment on column public.products.ingredients is 'comma-separated list — shown as "Zutaten: …"';
comment on column public.products.allergens   is 'comma-separated list — shown as "Allergene: …"';
