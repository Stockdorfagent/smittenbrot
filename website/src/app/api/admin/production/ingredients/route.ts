import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST   /api/admin/production/ingredients  { ingredient }  insert (no id) or update (id)
 * DELETE /api/admin/production/ingredients  { id }          refused while any recipe, product or starter uses it
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const i = body?.ingredient;
  if (!i || typeof i.name !== 'string' || !i.name.trim()) return bad('name is required.');
  if (i.unit !== 'g' && i.unit !== 'pcs') return bad('unit must be g or pcs.');
  let allergens: string[] | null = null;
  if (Array.isArray(i.allergens)) allergens = i.allergens.map((a: unknown) => String(a).trim()).filter(Boolean);
  else if (i.allergens === 'none') allergens = [];
  const gps = i.g_per_source_unit === null || i.g_per_source_unit === undefined || i.g_per_source_unit === '' ? null : Number(i.g_per_source_unit);
  if (gps !== null && !(gps > 0)) return bad('g_per_source_unit must be > 0.');
  if (i.derived_from && !gps) return bad('A derived ingredient needs g_per_source_unit.');
  if (i.derived_from && i.id && i.derived_from === i.id) return bad('An ingredient cannot derive from itself.');
  return withAdmin(req, async (db) => {
    const row = {
      name: i.name.trim(), unit: i.unit, name_de: (i.name_de ?? '').trim() || null, allergens,
      components_de: (i.components_de ?? '').trim() || null, derived_from: i.derived_from || null, g_per_source_unit: gps,
      notes: (i.notes ?? '').trim() || null, updated_at: new Date().toISOString(),
    };
    const { data: clash } = await db.from('pr_ingredients').select('id').ilike('name', row.name).neq('id', i.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle();
    if (clash) return bad(`An ingredient named "${row.name}" already exists.`);
    if (i.id) {
      const { error } = await db.from('pr_ingredients').update(row).eq('id', i.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ id: i.id });
    }
    const { data, error } = await db.from('pr_ingredients').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id });
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (!id) return bad('id is required.');
  return withAdmin(req, async (db) => {
    const [items, finals, starters, derived, recipes, products] = await Promise.all([
      db.from('pr_recipe_items').select('recipe_id').eq('ingredient_id', id),
      db.from('pr_recipe_items').select('recipe_id').eq('final_flour_ingredient_id', id),
      db.from('pr_starters').select('name').eq('maintenance_flour_ingredient_id', id),
      db.from('pr_ingredients').select('name').eq('derived_from', id),
      db.from('pr_recipes').select('name, per_batch_items'),
      db.from('pr_products').select('name, extras'),
    ]);
    const used: string[] = [];
    if (items.data?.length) used.push('recipe lines');
    if (finals.data?.length) used.push('a starter line (final flour)');
    if (starters.data?.length) used.push(`starter ${starters.data.map((s) => s.name).join(', ')}`);
    if (derived.data?.length) used.push(`derived ingredient ${derived.data.map((s) => s.name).join(', ')}`);
    const pb = (recipes.data ?? []).filter((r) => (r.per_batch_items ?? []).some((p: { ingredient_id: string }) => p.ingredient_id === id)).map((r) => r.name);
    if (pb.length) used.push(`per-batch items of ${pb.join(', ')}`);
    const ex = (products.data ?? []).filter((p) => (p.extras ?? []).some((e: { ingredient_id: string }) => e.ingredient_id === id)).map((p) => p.name);
    if (ex.length) used.push(`extras of ${ex.join(', ')}`);
    if (used.length) return bad(`Still used in ${used.join('; ')}.`, 409);
    const { error } = await db.from('pr_ingredients').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
