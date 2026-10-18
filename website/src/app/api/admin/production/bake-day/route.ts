import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { getBakeSheet, loadFreezer, loadProductionData } from '@/lib/production/data';
import { cutoffInfo, isValidISODate, isBakeDay } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/production/bake-day?date=YYYY-MM-DD[&live=1]
 *      → { sheet, row, frozen, cutoff, is_bake_day, data }
 * POST /api/admin/production/bake-day
 *      { date, action: 'save_day', extra_quantities?, adjustments?, notes? }   edit the day, returns the recomputed sheet
 *      { date, action: 'recompute' }                                            drop the snapshot and compute again
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!isValidISODate(date)) return bad('date must be YYYY-MM-DD.');
  const live = req.nextUrl.searchParams.get('live') === '1';
  return withAdmin(req, async (db) => {
    const { sheet, row, frozen, data, b2b, web } = await getBakeSheet(db, date, { forceLive: live });
    const freezer = await loadFreezer(db, date, data, row.extra_quantities);
    return NextResponse.json({ sheet, row: { ...row, snapshot: undefined }, frozen, cutoff: cutoffInfo(date), is_bake_day: isBakeDay(date), data, b2b, web, freezer });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const date = body?.date ?? '';
  if (!isValidISODate(date)) return bad('date must be YYYY-MM-DD.');
  return withAdmin(req, async (db) => {
    const now = new Date().toISOString();
    if (body.action === 'recompute') {
      const { error } = await db.from('pr_bake_days').upsert({ date, snapshot: null, snapshot_at: null, updated_at: now }, { onConflict: 'date' });
      if (error) throw new Error(error.message);
    } else if (body.action === 'save_day') {
      const data = await loadProductionData(db);
      const productIds = new Set(data.products.map((p) => p.id));
      const extras = Array.isArray(body.extra_quantities) ? body.extra_quantities : undefined;
      const adjustments = Array.isArray(body.adjustments) ? body.adjustments : undefined;
      if (extras) {
        for (const e of extras) {
          if (!productIds.has(e.pr_product_id)) return bad('Extra quantity names an unknown product.');
          if (!(Number(e.qty) > 0)) return bad('Extra quantity must be > 0.');
        }
      }
      if (adjustments) {
        for (const a of adjustments) {
          const r = data.recipes.find((x) => x.id === a.recipe_id);
          if (!r || !r.items.some((it) => it.id === a.item_id)) return bad('Adjustment names an unknown recipe line.');
          if (!(Number(a.pct) >= 0)) return bad('Adjusted percentage must be ≥ 0.');
        }
      }
      const patch: Record<string, unknown> = { date, updated_at: now, snapshot: null, snapshot_at: null };
      if (extras) patch.extra_quantities = extras.map((e: { pr_product_id: string; qty: number; reason?: string | null }) => ({ pr_product_id: e.pr_product_id, qty: Number(e.qty), reason: e.reason || null }));
      if (adjustments) patch.adjustments = adjustments.map((a: { recipe_id: string; item_id: string; pct: number }) => ({ recipe_id: a.recipe_id, item_id: a.item_id, pct: Number(a.pct) }));
      if (typeof body.notes === 'string') patch.notes = body.notes || null;
      const { error } = await db.from('pr_bake_days').upsert(patch, { onConflict: 'date' });
      if (error) throw new Error(error.message);
    } else {
      return bad('Unknown action.');
    }
    const { sheet, row, frozen, data, b2b, web } = await getBakeSheet(db, date);
    const freezer = await loadFreezer(db, date, data, row.extra_quantities);
    return NextResponse.json({ sheet, row: { ...row, snapshot: undefined }, frozen, cutoff: cutoffInfo(date), is_bake_day: isBakeDay(date), data, b2b, web, freezer });
  });
}
