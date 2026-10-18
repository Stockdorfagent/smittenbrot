import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { loadFreezer, loadFreezerRaw, loadProductionData } from '@/lib/production/data';
import { counterOf } from '@/lib/production/freezer';
import { isValidISODate, berlinTodayISO } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/production/freezer[?date=YYYY-MM-DD]   → { status: FreezerStatus[], movements, settings }
 * POST /api/admin/production/freezer  { action, ... }
 *   save_settings   { pr_product_id, batch_size, min_level, max_age_days }
 *   book_batch      { pr_product_id, date, qty, note? }      confirm "made n pieces today" (one per product+day, replaces)
 *   unbook_batch    { pr_product_id, date }
 *   set_count       { pr_product_id, counted, note? }        stock count → books the difference as 'count'
 *   manual          { pr_product_id, qty, note }             ± correction (e.g. discard)
 *   delete_movement { id }                                   count/manual rows only
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || berlinTodayISO();
  if (!isValidISODate(date)) return bad('date must be YYYY-MM-DD.');
  return withAdmin(req, async (db) => {
    const data = await loadProductionData(db);
    const { data: day } = await db.from('pr_bake_days').select('extra_quantities').eq('date', date).maybeSingle();
    const extras = (day?.extra_quantities ?? []) as { pr_product_id: string; qty: number }[];
    const [status, raw] = await Promise.all([loadFreezer(db, date, data, extras), loadFreezerRaw(db)]);
    return NextResponse.json({ date, status, movements: raw.movements, settings: raw.settings });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.action) return bad('action is required.');
  return withAdmin(req, async (db) => {
    const today = berlinTodayISO();
    switch (body.action) {
      case 'save_settings': {
        const bs = Number(body.batch_size), ml = Number(body.min_level);
        const age = body.max_age_days === null || body.max_age_days === undefined || body.max_age_days === '' ? null : Number(body.max_age_days);
        if (!body.pr_product_id || !(bs > 0) || !(ml >= 0) || (age !== null && !(age > 0))) return bad('batch_size > 0, min_level ≥ 0, max_age_days empty or > 0.');
        const { error } = await db.from('pr_freezer_settings').upsert({ pr_product_id: body.pr_product_id, batch_size: bs, min_level: ml, max_age_days: age, updated_at: new Date().toISOString() }, { onConflict: 'pr_product_id' });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'book_batch': {
        const qty = Number(body.qty);
        if (!body.pr_product_id || !isValidISODate(body.date ?? '') || !(qty > 0)) return bad('pr_product_id, date and qty > 0 are required.');
        const { error } = await db.from('pr_freezer_movements').upsert({ pr_product_id: body.pr_product_id, date: body.date, kind: 'batch', qty, note: (body.note ?? '').trim() || 'confirmed on the bake sheet' }, { onConflict: 'pr_product_id,date,kind' });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'unbook_batch': {
        if (!body.pr_product_id || !isValidISODate(body.date ?? '')) return bad('pr_product_id and date are required.');
        const { error } = await db.from('pr_freezer_movements').delete().eq('pr_product_id', body.pr_product_id).eq('date', body.date).eq('kind', 'batch');
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'set_count': {
        const counted = Number(body.counted);
        if (!body.pr_product_id || !(counted >= 0)) return bad('pr_product_id and counted ≥ 0 are required.');
        const { movements } = await loadFreezerRaw(db);
        const current = counterOf(movements.filter((m) => m.pr_product_id === body.pr_product_id && m.date <= today));
        const diff = counted - current;
        if (diff === 0) return NextResponse.json({ ok: true, diff: 0 });
        const { error } = await db.from('pr_freezer_movements').insert({ pr_product_id: body.pr_product_id, date: today, kind: 'count', qty: diff, note: (body.note ?? '').trim() || `counted ${counted} (was ${current})` });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, diff });
      }
      case 'manual': {
        const qty = Number(body.qty);
        if (!body.pr_product_id || !qty || !Number.isFinite(qty)) return bad('pr_product_id and a non-zero qty are required.');
        const { error } = await db.from('pr_freezer_movements').insert({ pr_product_id: body.pr_product_id, date: today, kind: 'manual', qty, note: (body.note ?? '').trim() || null });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'delete_movement': {
        if (!body.id) return bad('id is required.');
        const { error } = await db.from('pr_freezer_movements').delete().eq('id', body.id).in('kind', ['count', 'manual']);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      default:
        return bad('Unknown action.');
    }
  });
}
