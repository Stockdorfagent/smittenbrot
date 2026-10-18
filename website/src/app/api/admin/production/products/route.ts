import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST   /api/admin/production/products  { product }  insert (no id) or update (id).
 *        Web products are linked by product_id (never by name); internal products have none.
 * DELETE /api/admin/production/products  { id }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const p = body?.product;
  if (!p) return bad('product is required.');
  if (p.channel !== 'web' && p.channel !== 'intern') return bad('channel must be web or intern.');
  if (p.production !== 'orders' && p.production !== 'stock') return bad('production must be orders or stock.');
  const dpu = Number(p.dough_per_unit_g);
  if (!(dpu > 0)) return bad('dough_per_unit_g must be > 0.');
  const extras = Array.isArray(p.extras) ? p.extras : [];
  for (const e of extras) if (!e.ingredient_id || !(Number(e.grams) >= 0)) return bad('Extras need an ingredient and grams ≥ 0.');
  return withAdmin(req, async (db) => {
    let name = (p.name ?? '').trim();
    let product_id: string | null = null;
    let link_status: 'linked' | 'pending' | 'internal' = 'internal';
    let pieces = p.pieces_per_unit === null || p.pieces_per_unit === undefined || p.pieces_per_unit === '' ? null : Number(p.pieces_per_unit);
    if (p.channel === 'web') {
      if (p.product_id) {
        const { data: shop } = await db.from('products').select('id, name, unit_label').eq('id', p.product_id).maybeSingle();
        if (!shop) return bad('Shop product not found.');
        product_id = shop.id; name = shop.name; link_status = 'linked';
        if (pieces === null) { const m = (shop.unit_label ?? '').match(/^(\d+)\s*Stück$/i); if (m) pieces = Number(m[1]); }
        const { data: dup } = await db.from('pr_products').select('id').eq('product_id', product_id).neq('id', p.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle();
        if (dup) return bad(`${shop.name} is already linked.`);
      } else {
        if (!name) return bad('A pending web product needs the exact shop name.');
        link_status = 'pending';
      }
    } else if (!name) return bad('name is required.');
    if (p.recipe_id) {
      const { data: r } = await db.from('pr_recipes').select('kind').eq('id', p.recipe_id).maybeSingle();
      if (!r) return bad('Recipe not found.');
      if (r.kind !== 'dough') return bad('Products need a dough recipe, not a sub-recipe.');
    }
    const row = {
      product_id, name, channel: p.channel, recipe_id: p.recipe_id || null, dough_per_unit_g: dpu,
      bake_loss_pct: p.bake_loss_pct === null || p.bake_loss_pct === undefined || p.bake_loss_pct === '' ? null : Number(p.bake_loss_pct),
      extras: extras.map((e: { ingredient_id: string; grams: unknown }) => ({ ingredient_id: e.ingredient_id, grams: Number(e.grams) })),
      production: p.production, pieces_per_unit: pieces, link_status, updated_at: new Date().toISOString(),
    };
    if (p.id) {
      const { error } = await db.from('pr_products').update(row).eq('id', p.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ id: p.id });
    }
    const { data, error } = await db.from('pr_products').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id });
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return bad('id is required.');
  return withAdmin(req, async (db) => {
    const { error } = await db.from('pr_products').delete().eq('id', body.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
