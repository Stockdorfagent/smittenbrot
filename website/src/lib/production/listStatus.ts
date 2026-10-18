/**
 * Step 1b — status of every shop product's generated ingredient list
 * (shared by the approval API, the approval page and the bake-sheet notice).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProductionData } from './data.ts';
import { generateIngredientList, diffLists, type GeneratedList } from './ingredientList.ts';

export type ListStatus = 'ok' | 'outdated' | 'new' | 'blocked' | 'manual' | 'no_recipe';

export interface ProductListRow {
  product_id: string;
  name: string;
  active: boolean;
  status: ListStatus;
  generated: GeneratedList | null;
  approved_text: string | null;            // products.ingredients_generated
  current_ingredients: string | null;      // products.ingredients (what customers see today)
  current_allergens: string | null;
  approved_at: string | null;
  diff: { added: string[]; removed: string[]; same: boolean } | null;
  allergens_changed: boolean;
}

export async function computeRows(db: SupabaseClient): Promise<ProductListRow[]> {
  const [data, shop] = await Promise.all([
    loadProductionData(db),
    db.from('products').select('id, name, active, ingredients, allergens, ingredients_generated, ingredients_status, ingredients_approved_at').order('active', { ascending: false }).order('sort_order'),
  ]);
  if (shop.error) throw new Error(shop.error.message);
  return (shop.data ?? []).map((p) => {
    const link = data.products.find((x) => x.product_id === p.id);
    const generated = link ? generateIngredientList(link, data) : null;
    let status: ListStatus;
    if (!link || !link.recipe_id) status = 'no_recipe';
    else if (p.ingredients_status === 'manual') status = 'manual';
    else if (!generated?.ok) status = 'blocked';
    else if (!p.ingredients_generated) status = 'new';
    else if (p.ingredients_generated === generated.text && (p.allergens ?? '') === generated.allergens_text) status = 'ok';
    else status = 'outdated';
    return {
      product_id: p.id, name: p.name, active: !!p.active, status, generated,
      approved_text: p.ingredients_generated ?? null, current_ingredients: p.ingredients ?? null, current_allergens: p.allergens ?? null,
      approved_at: p.ingredients_approved_at ?? null,
      diff: generated ? diffLists(p.ingredients_generated ?? p.ingredients ?? null, generated.text) : null,
      allergens_changed: !!generated && (p.allergens ?? '') !== generated.allergens_text,
    };
  });
}

