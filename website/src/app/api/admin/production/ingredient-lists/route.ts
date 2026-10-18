import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { computeRows, type ProductListRow } from '@/lib/production/listStatus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/production/ingredient-lists            → { rows }
 * POST /api/admin/production/ingredient-lists  { action: 'approve', product_id } | { action: 'approve_all' } | { action: 'set_manual', product_id, manual: boolean }
 *
 * Approve writes: ingredients_generated (markers), ingredients (legacy, CAPITALS), allergens, status 'generated'.
 * The shop keeps showing the old text until approved (SPEC §1b.3).
 */
export async function GET(req: NextRequest) {
  return withAdmin(req, async (db) => NextResponse.json({ rows: await computeRows(db) }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.action) return bad('action is required.');
  return withAdmin(req, async (db) => {
    const rows = await computeRows(db);
    const approve = async (row: ProductListRow) => {
      if (!row.generated?.ok) throw new Error(`${row.name}: ${row.generated?.blocked.join(' ') ?? 'no recipe'}`);
      const { error } = await db.from('products').update({
        ingredients_generated: row.generated.text,
        ingredients: row.generated.legacy,
        allergens: row.generated.allergens_text,
        ingredients_status: 'generated',
        ingredients_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.product_id);
      if (error) throw new Error(error.message);
    };
    if (body.action === 'approve') {
      const row = rows.find((r) => r.product_id === body.product_id);
      if (!row) return bad('Product not found.');
      await approve(row);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'approve_all') {
      const todo = rows.filter((r) => r.status === 'new' || r.status === 'outdated');
      for (const r of todo) await approve(r);
      return NextResponse.json({ ok: true, approved: todo.map((r) => r.name) });
    }
    if (body.action === 'set_manual') {
      const row = rows.find((r) => r.product_id === body.product_id);
      if (!row) return bad('Product not found.');
      const { error } = await db.from('products').update({ ingredients_status: body.manual ? 'manual' : null, ingredients_generated: body.manual ? null : row.approved_text, updated_at: new Date().toISOString() }).eq('id', body.product_id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return bad('Unknown action.');
  });
}
