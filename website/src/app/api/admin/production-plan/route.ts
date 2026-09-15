import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import path from 'path';
import { requireAdmin } from '@/lib/apiAuth';
import { paymentMethodLabel, orderStatusAdminLabels } from '@/lib/adminLabels';

/**
 * GET /api/admin/production-plan?from=YYYY-MM-DD[&to=YYYY-MM-DD]
 *
 * The owner's Excel production plan (templates/production-plan.xlsx, 10 tabs
 * of recipes, dough schedule and planning) with the "Orders" tab filled from
 * the database: one row per product line of every order for the chosen
 * pickup day(s), all statuses except cancelled/refunded — identical to the
 * "Produktionsexport" CSV. The Overview tab sums it with
 * SUMIFS(Orders!G:G, Orders!F:F, name), so column F must stay Produkt and
 * column G Menge. All other tabs are passed through untouched; Excel
 * recalculates on open (fullCalcOnLoad).
 *
 * Verified 15.09.2026: a round trip through exceljs keeps every formula in
 * every sheet (per-sheet formula counts identical before/after).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = ['Bestellnummer', 'Bestelldatum', 'Abholtag', 'Typ', 'Name', 'Produkt', 'Menge', 'Einzelpreis_Cent', 'Gesamtpreis_Bestellung_Cent', 'Rabattcode', 'Rabatt_Cent', 'Zahlungsart', 'Status', 'Zahlung', 'Abholort'];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;

  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Bitte einen Abholtag wählen (YYYY-MM-DD).' }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: orders, error } = await supabase
    .from('orders')
    .select('order_number, created_at, fulfillment_date, order_type, customer_name, customer_email, total_cents, discount_code, discount_cents, payment_method, status, payment_status, pickup_locations(name), order_items(quantity, unit_price_cents, products(name))')
    .not('status', 'in', '("cancelled","refunded")')
    .gte('fulfillment_date', from)
    .lte('fulfillment_date', to)
    .order('fulfillment_date', { ascending: true })
    .order('order_number', { ascending: true })
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), 'templates', 'production-plan.xlsx'));
  const ws = wb.getWorksheet('Orders');
  if (!ws) return NextResponse.json({ error: 'Vorlage hat kein Blatt "Orders".' }, { status: 500 });

  // Overwrite from row 1: the template's Orders tab carries empty formatted
  // rows, and spliceRows/addRow would append BELOW them (header on row 39).
  const rows: (string | number)[][] = [];
  let latest = from;
  for (const o of orders ?? []) {
    if (o.fulfillment_date && o.fulfillment_date > latest) latest = o.fulfillment_date;
    const items = (o.order_items || []) as { quantity: number; unit_price_cents: number; products?: { name?: string } | null }[];
    for (const it of items) {
      rows.push([
        o.order_number || '',
        (o.created_at || '').slice(0, 10),
        o.fulfillment_date || '',
        o.order_type === 'subscription' ? 'Abo' : 'Einmalig',
        o.customer_name || o.customer_email || '',
        it.products?.name || 'Unbekannt',
        it.quantity,
        it.unit_price_cents,
        o.total_cents,
        o.discount_code || '',
        o.discount_cents || 0,
        paymentMethodLabel(o.payment_method),
        orderStatusAdminLabels[o.status] || o.status,
        o.payment_status || '',
        (o.pickup_locations as { name?: string } | null)?.name || '',
      ]);
    }
  }
  const oldCount = ws.rowCount;
  ws.getRow(1).values = HEADERS;
  ws.getRow(1).font = { bold: true };
  rows.forEach((r, i) => { ws.getRow(i + 2).values = r; });
  for (let r = rows.length + 2; r <= oldCount; r++) ws.getRow(r).values = [];
  wb.calcProperties.fullCalcOnLoad = true;

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${latest}_production-plan.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
