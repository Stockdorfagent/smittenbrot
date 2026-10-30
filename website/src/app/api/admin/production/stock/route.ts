import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { bookBatch, confirmDelivery, deleteBatch, loadProductionData, loadStockRaw, saveDraftDelivery, unconfirmDelivery, type DeliveryInput } from '@/lib/production/data';
import { ingredientPrices, planBatch, stockRows } from '@/lib/production/stock';
import { berlinTodayISO, isValidISODate } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/production/stock → { today, rows: StockRow[], suppliers, deliveries (drafts + last 40 confirmed), supplier_items, ledger (counts/manual, last 100), batches (last 40) }
 * POST /api/admin/production/stock { action, ... }
 *   save_supplier   { name }                      → { id }
 *   save_delivery   { delivery: DeliveryInput }   draft insert/replace → { id }
 *   confirm         { id }                        books purchases, remembers supplier items
 *   unconfirm       { id }                        removes the purchases, back to draft
 *   delete_delivery { id }                        drafts only
 *   set_count       { ingredient_id, counted, note? }   books the difference as 'count'
 *   manual          { ingredient_id, amount, note }      ± correction
 *   delete_movement { id }                        count/manual rows only
 *   plan_batch      { ingredient_id, amount }     → BatchPlan (preview, nothing saved)
 *   book_batch      { ingredient_id, amount, date, note? }  components out, made amount in, priced → { id }
 *   delete_batch    { id }                        undo
 */
export async function GET(req: NextRequest) {
  return withAdmin(req, async (db) => {
    const today = berlinTodayISO();
    const [data, raw] = await Promise.all([loadProductionData(db), loadStockRaw(db)]);
    const rows = stockRows(data, raw.ledger, raw.deliveries, today, raw.batches);
    const confirmed = raw.deliveries.filter((d) => d.status === 'confirmed').slice(0, 40);
    const drafts = raw.deliveries.filter((d) => d.status === 'draft');
    const movements = raw.ledger.filter((r) => r.kind === 'count' || r.kind === 'manual').slice(-100).reverse();
    return NextResponse.json({ today, rows, suppliers: raw.suppliers, deliveries: [...drafts, ...confirmed], supplier_items: raw.supplier_items, movements, batches: raw.batches.slice(0, 40) });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.action) return bad('action is required.');
  return withAdmin(req, async (db) => {
    switch (body.action) {
      case 'save_supplier': {
        const name = String(body.name ?? '').trim();
        if (!name) return bad('name is required.');
        const { data, error } = await db.from('pr_suppliers').upsert({ name }, { onConflict: 'name' }).select('id').single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ id: data.id });
      }
      case 'save_delivery': {
        const d = body.delivery as DeliveryInput | undefined;
        if (!d || !isValidISODate(d.date ?? '')) return bad('date must be YYYY-MM-DD.');
        const fee = Number(d.delivery_fee_cents ?? 0);
        if (!(fee >= 0) || !Number.isInteger(fee)) return bad('delivery_fee_cents must be a whole number ≥ 0.');
        const lines = Array.isArray(d.lines) ? d.lines : [];
        for (const l of lines) {
          if (!(Number(l.qty) > 0) || !(Number(l.pack_amount) > 0)) return bad('Every line needs packs > 0 and a pack size > 0.');
          if (!(Number(l.price_cents) >= 0) || !Number.isInteger(Number(l.price_cents))) return bad('Line price must be ≥ 0.');
          if (l.bbf && !isValidISODate(l.bbf)) return bad('Best-before must be YYYY-MM-DD.');
        }
        const id = await saveDraftDelivery(db, {
          id: d.id || undefined, supplier_id: d.supplier_id || null, date: d.date, invoice_no: (d.invoice_no ?? '').trim() || null, delivery_fee_cents: fee, notes: (d.notes ?? '').trim() || null,
          file_path: typeof d.file_path === 'string' && /^invoices\/[\w\-./]+$/.test(d.file_path) ? d.file_path : null, source: d.file_path ? 'upload' : undefined,
          lines: lines.map((l) => ({ ingredient_id: l.ingredient_id || null, item_text: (l.item_text ?? '').trim() || null, qty: Number(l.qty), pack_amount: Number(l.pack_amount), price_cents: Number(l.price_cents), bbf: l.bbf || null })),
        });
        return NextResponse.json({ id });
      }
      case 'confirm': {
        if (!body.id) return bad('id is required.');
        await confirmDelivery(db, body.id);
        return NextResponse.json({ ok: true });
      }
      case 'unconfirm': {
        if (!body.id) return bad('id is required.');
        await unconfirmDelivery(db, body.id);
        return NextResponse.json({ ok: true });
      }
      case 'delete_delivery': {
        if (!body.id) return bad('id is required.');
        const { error } = await db.from('pr_deliveries').delete().eq('id', body.id).eq('status', 'draft');
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'set_count': {
        const counted = Number(body.counted);
        if (!body.ingredient_id || !(counted >= 0)) return bad('ingredient_id and counted ≥ 0 are required.');
        const raw = await loadStockRaw(db);
        const level = raw.ledger.filter((r) => r.ingredient_id === body.ingredient_id).reduce((s, r) => s + r.amount, 0);
        const diff = counted - level;
        if (diff === 0) return NextResponse.json({ ok: true, diff: 0 });
        const { error } = await db.from('pr_stock_ledger').insert({ ingredient_id: body.ingredient_id, date: berlinTodayISO(), kind: 'count', amount: diff, note: (body.note ?? '').trim() || `counted ${counted}` });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, diff });
      }
      case 'manual': {
        const amount = Number(body.amount);
        if (!body.ingredient_id || !amount || !Number.isFinite(amount)) return bad('ingredient_id and a non-zero amount are required.');
        const { error } = await db.from('pr_stock_ledger').insert({ ingredient_id: body.ingredient_id, date: berlinTodayISO(), kind: 'manual', amount, note: (body.note ?? '').trim() || null });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'delete_movement': {
        if (!body.id) return bad('id is required.');
        const { error } = await db.from('pr_stock_ledger').delete().eq('id', body.id).in('kind', ['count', 'manual']);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'plan_batch': {
        const amount = Number(body.amount);
        if (!body.ingredient_id || !(amount > 0)) return bad('ingredient_id and amount > 0 are required.');
        const [data, raw] = await Promise.all([loadProductionData(db), loadStockRaw(db)]);
        return NextResponse.json(planBatch(body.ingredient_id, amount, data, ingredientPrices(raw.deliveries, raw.batches)));
      }
      case 'book_batch': {
        const amount = Number(body.amount);
        if (!body.ingredient_id || !(amount > 0)) return bad('ingredient_id and amount > 0 are required.');
        if (!isValidISODate(body.date ?? '')) return bad('date must be YYYY-MM-DD.');
        const r = await bookBatch(db, { ingredient_id: body.ingredient_id, amount, date: body.date, note: (body.note ?? '').trim() || null });
        return NextResponse.json(r);
      }
      case 'delete_batch': {
        if (!body.id) return bad('id is required.');
        await deleteBatch(db, body.id);
        return NextResponse.json({ ok: true });
      }
      default: return bad('Unknown action.');
    }
  });
}
