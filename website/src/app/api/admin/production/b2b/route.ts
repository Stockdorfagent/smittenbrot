import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { loadB2B } from '@/lib/production/data';
import { isValidISODate } from '@/lib/production/bakeDays';
import { rangeHasWeekday, WEEKDAYS } from '@/lib/production/b2b';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/production/b2b[?since=YYYY-MM-DD]   → { clients, standing, upcoming_manual, upcoming_overrides }  (from today, or from `since`)
 * POST /api/admin/production/b2b  { action, ... }
 *   save_client     { client: { id?, name, notes, active } }
 *   delete_client   { id }                       (cascades standing orders, overrides; one-offs keep their label)
 *   save_standing   { standing: { id?, client_id, weekday, items, valid_from, valid_to, active, notes } }
 *   delete_standing { id }
 *   save_override   { override: { client_id, date, skip, items|null, note } }   one row per client+date
 *   delete_override { client_id, date }
 *   save_manual     { manual: { id?, date, type, client_id, label, items, notes } }   any date (B2B days need not be shop days); b2b needs client_id
 *   delete_manual   { id }
 */
export async function GET(req: NextRequest) {
  return withAdmin(req, async (db) => {
    const { clients, standing } = await loadB2B(db);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const sinceParam = req.nextUrl.searchParams.get('since') ?? '';
    const since = isValidISODate(sinceParam) && sinceParam < today ? sinceParam : today;
    const [m, o] = await Promise.all([
      db.from('pr_manual_orders').select('*').gte('date', since).order('date'),
      db.from('pr_b2b_day_overrides').select('*').gte('date', since).order('date'),
    ]);
    return NextResponse.json({ clients, standing, upcoming_manual: m.data ?? [], upcoming_overrides: o.data ?? [] });
  });
}

type Item = { pr_product_id: string; qty: unknown };
function cleanItems(raw: unknown): { pr_product_id: string; qty: number }[] | string {
  if (!Array.isArray(raw)) return 'items must be a list.';
  const out: { pr_product_id: string; qty: number }[] = [];
  for (const i of raw as Item[]) {
    if (!i.pr_product_id) continue;
    const q = Number(i.qty);
    if (!(q > 0)) return 'Every quantity must be > 0.';
    out.push({ pr_product_id: i.pr_product_id, qty: q });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.action) return bad('action is required.');
  return withAdmin(req, async (db) => {
    const now = new Date().toISOString();
    switch (body.action) {
      case 'save_client': {
        const c = body.client ?? {};
        if (typeof c.name !== 'string' || !c.name.trim()) return bad('Client name is required.');
        const row = { name: c.name.trim(), notes: (c.notes ?? '').trim() || null, active: c.active !== false, updated_at: now };
        if (c.id) {
          const { error } = await db.from('pr_b2b_clients').update(row).eq('id', c.id);
          if (error) throw new Error(error.message);
          return NextResponse.json({ id: c.id });
        }
        const { data, error } = await db.from('pr_b2b_clients').insert(row).select('id').single();
        if (error) throw new Error(error.message.includes('duplicate') ? 'A client with this name already exists.' : error.message);
        return NextResponse.json({ id: data.id });
      }
      case 'delete_client': {
        if (!body.id) return bad('id is required.');
        const { error } = await db.from('pr_b2b_clients').delete().eq('id', body.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'save_standing': {
        const s = body.standing ?? {};
        if (!s.client_id) return bad('client_id is required.');
        const weekday = Number(s.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return bad('weekday must be 0–6.');
        const items = cleanItems(s.items);
        if (typeof items === 'string') return bad(items);
        if (s.valid_from && !isValidISODate(s.valid_from)) return bad('valid_from must be YYYY-MM-DD.');
        if (s.valid_to && !isValidISODate(s.valid_to)) return bad('valid_to must be YYYY-MM-DD.');
        if (!rangeHasWeekday(weekday, s.valid_from || null, s.valid_to || null)) return bad(`The validity window ${s.valid_from} – ${s.valid_to} contains no ${WEEKDAYS[weekday]}, so nothing would ever be planned. For one delivery use a single order on the bake day instead.`);
        const row = { client_id: s.client_id, weekday, items, valid_from: s.valid_from || null, valid_to: s.valid_to || null, active: s.active !== false, notes: (s.notes ?? '').trim() || null, updated_at: now };
        const { data, error } = await db.from('pr_standing_orders').upsert(row, { onConflict: 'client_id,weekday' }).select('id').single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ id: data.id });
      }
      case 'delete_standing': {
        if (!body.id) return bad('id is required.');
        const { error } = await db.from('pr_standing_orders').delete().eq('id', body.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'save_override': {
        const o = body.override ?? {};
        if (!o.client_id || !isValidISODate(o.date ?? '')) return bad('client_id and date are required.');
        let items: { pr_product_id: string; qty: number }[] | null = null;
        if (!o.skip) {
          const cleaned = cleanItems(o.items);
          if (typeof cleaned === 'string') return bad(cleaned);
          items = cleaned;
        }
        const row = { client_id: o.client_id, date: o.date, skip: !!o.skip, items, note: (o.note ?? '').trim() || null, updated_at: now };
        const { data, error } = await db.from('pr_b2b_day_overrides').upsert(row, { onConflict: 'client_id,date' }).select('id').single();
        if (error) throw new Error(error.message);
        await db.from('pr_bake_days').update({ snapshot: null, snapshot_at: null }).eq('date', o.date);
        return NextResponse.json({ id: data.id });
      }
      case 'delete_override': {
        if (!body.client_id || !isValidISODate(body.date ?? '')) return bad('client_id and date are required.');
        const { error } = await db.from('pr_b2b_day_overrides').delete().eq('client_id', body.client_id).eq('date', body.date);
        if (error) throw new Error(error.message);
        await db.from('pr_bake_days').update({ snapshot: null, snapshot_at: null }).eq('date', body.date);
        return NextResponse.json({ ok: true });
      }
      case 'save_manual': {
        const m = body.manual ?? {};
        if (!isValidISODate(m.date ?? '')) return bad('date must be YYYY-MM-DD.');
        if (!['b2b', 'market', 'test', 'own'].includes(m.type)) return bad('type must be b2b, market, test or own.');
        if (m.type === 'b2b' && !m.client_id) return bad('Choose the client for a B2B single order.');
        const items = cleanItems(m.items);
        if (typeof items === 'string') return bad(items);
        if (items.length === 0) return bad('Add at least one product.');
        const row = { date: m.date, type: m.type, client_id: m.type === 'b2b' ? (m.client_id || null) : null, label: (m.label ?? '').trim() || null, items, notes: (m.notes ?? '').trim() || null, updated_at: now };
        if (m.id) {
          const { error } = await db.from('pr_manual_orders').update(row).eq('id', m.id);
          if (error) throw new Error(error.message);
          await db.from('pr_bake_days').update({ snapshot: null, snapshot_at: null }).eq('date', m.date);
          return NextResponse.json({ id: m.id });
        }
        const { data, error } = await db.from('pr_manual_orders').insert(row).select('id').single();
        if (error) throw new Error(error.message);
        await db.from('pr_bake_days').update({ snapshot: null, snapshot_at: null }).eq('date', m.date);
        return NextResponse.json({ id: data.id });
      }
      case 'delete_manual': {
        if (!body.id) return bad('id is required.');
        const { data: old } = await db.from('pr_manual_orders').select('date').eq('id', body.id).maybeSingle();
        const { error } = await db.from('pr_manual_orders').delete().eq('id', body.id);
        if (error) throw new Error(error.message);
        if (old?.date) await db.from('pr_bake_days').update({ snapshot: null, snapshot_at: null }).eq('date', old.date);
        return NextResponse.json({ ok: true });
      }
      default:
        return bad('Unknown action.');
    }
  });
}
