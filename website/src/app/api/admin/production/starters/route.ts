import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST   /api/admin/production/starters  { starter: { id?, name, maintenance_flour_ingredient_id, stages: [...] } }
 *        Stages are replaced as a whole; stage 1 = last refresh, day_offset relative to the bake day.
 * DELETE /api/admin/production/starters  { id }   refused while a recipe uses it
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const s = body?.starter;
  if (!s || typeof s.name !== 'string' || !s.name.trim()) return bad('name is required.');
  if (!Array.isArray(s.stages) || s.stages.length === 0) return bad('At least one stage is required.');
  const stages = s.stages.map((st: Record<string, unknown>, i: number) => ({
    stage_no: i + 1, day_offset: Number(st.day_offset), flour_parts: Number(st.flour_parts), water_parts: Number(st.water_parts),
    seed_parts: Number(st.seed_parts), flour_from_recipe: !!st.flour_from_recipe,
  }));
  for (const st of stages) {
    if (!Number.isInteger(st.day_offset) || st.day_offset > 0) return bad('day_offset must be a whole number ≤ 0.');
    if (!(st.flour_parts > 0) || !(st.water_parts >= 0) || !(st.seed_parts > 0)) return bad('Stage ratio parts must be numbers (flour > 0, water ≥ 0, seed > 0).');
  }
  return withAdmin(req, async (db) => {
    const head = { name: s.name.trim(), maintenance_flour_ingredient_id: s.maintenance_flour_ingredient_id || null };
    let id = s.id as string | undefined;
    if (id) {
      const { error } = await db.from('pr_starters').update(head).eq('id', id);
      if (error) throw new Error(error.message);
      const { error: e2 } = await db.from('pr_starter_stages').delete().eq('starter_id', id);
      if (e2) throw new Error(e2.message);
    } else {
      const { data, error } = await db.from('pr_starters').insert(head).select('id').single();
      if (error) throw new Error(error.message);
      id = data.id;
    }
    const { error: e3 } = await db.from('pr_starter_stages').insert(stages.map((st: Record<string, unknown>) => ({ ...st, starter_id: id })));
    if (e3) throw new Error(e3.message);
    return NextResponse.json({ id });
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return bad('id is required.');
  return withAdmin(req, async (db) => {
    const { data: uses } = await db.from('pr_recipe_items').select('recipe_id').eq('starter_id', body.id);
    if (uses?.length) return bad('Still used by a recipe.', 409);
    const { error } = await db.from('pr_starters').delete().eq('id', body.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
