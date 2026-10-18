import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { loadProductionData, saveRecipe, type RecipeInput } from '@/lib/production/data';
import { validateRecipe } from '@/lib/production/engine';
import type { Recipe } from '@/lib/production/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST   /api/admin/production/recipes   { recipe: RecipeInput, note?: string }  → { id, version }
 *        Validates (unknown items, cycles, Σpct) and writes the next version.
 * DELETE /api/admin/production/recipes   { id }   refused while a product or another recipe uses it.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const input = body?.recipe as RecipeInput | undefined;
  if (!input || typeof input.name !== 'string' || !Array.isArray(input.items)) return bad('recipe is required.');
  if (input.kind !== 'dough' && input.kind !== 'sub') return bad('kind must be dough or sub.');
  return withAdmin(req, async (db) => {
    const data = await loadProductionData(db);
    const candidate: Recipe = {
      id: input.id ?? 'new', name: input.name, kind: input.kind, base_ingredient_id: input.base_ingredient_id ?? null,
      dough_margin_factor: input.kind === 'dough' ? numOrNull(input.dough_margin_factor) : null,
      build_margin_pct: input.kind === 'sub' ? numOrNull(input.build_margin_pct) : null,
      max_batch_g: numOrNull(input.max_batch_g), per_batch_items: (input.per_batch_items ?? []).map((p) => ({ ingredient_id: p.ingredient_id, amount: Number(p.amount) })),
      current_version: 0, notes: input.notes ?? null,
      items: input.items.map((it, i) => ({
        id: it.id || `new-${i}`, position: Number(it.position ?? i + 1), type: it.type, ingredient_id: it.ingredient_id ?? null, sub_recipe_id: it.sub_recipe_id ?? null,
        starter_id: it.starter_id ?? null, final_flour_ingredient_id: it.final_flour_ingredient_id ?? null, pct: Number(it.pct), label: it.label ?? null,
      })),
    };
    const clash = data.recipes.find((r) => r.name.trim().toLowerCase() === candidate.name.trim().toLowerCase() && r.id !== candidate.id);
    if (clash) return bad(`A recipe named "${clash.name}" already exists.`);
    for (const p of candidate.per_batch_items) {
      if (!data.ingredients.some((i) => i.id === p.ingredient_id)) return bad('Per-batch item names an unknown ingredient.');
      if (!(p.amount > 0)) return bad('Per-batch amounts must be > 0.');
    }
    const errors = validateRecipe(candidate, data);
    if (errors.length) return NextResponse.json({ error: errors.join(' '), errors }, { status: 422 });
    const result = await saveRecipe(db, { ...input, items: candidate.items.map((it) => ({ ...it, id: null })), dough_margin_factor: candidate.dough_margin_factor, build_margin_pct: candidate.build_margin_pct, max_batch_g: candidate.max_batch_g, per_batch_items: candidate.per_batch_items }, typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null);
    return NextResponse.json(result);
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (!id) return bad('id is required.');
  return withAdmin(req, async (db) => {
    const [{ data: products }, { data: uses }] = await Promise.all([
      db.from('pr_products').select('name').eq('recipe_id', id),
      db.from('pr_recipe_items').select('recipe_id').eq('sub_recipe_id', id),
    ]);
    if (products?.length) return bad(`Still linked to: ${products.map((p) => p.name).join(', ')}. Unlink the products first.`, 409);
    if (uses?.length) return bad('Still used as a sub-recipe by another recipe.', 409);
    const { error } = await db.from('pr_recipes').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
