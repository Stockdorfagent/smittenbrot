import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { loadProductionData, loadStockRaw } from '@/lib/production/data';
import { ingredientPrices, productCost, type IngredientPrice, type ProductCost } from '@/lib/production/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface CostRow extends ProductCost {
  web_price_cents: number | null;      // shop price, gross incl. 7 %
  web_net_cents: number | null;
  b2b_net_cents: number | null;
}
export interface PriceRow extends IngredientPrice { name: string; unit: 'g' | 'pcs'; supplier: string | null }

/**
 * GET  /api/admin/production/costs → { products: CostRow[], prices: PriceRow[] }
 * POST /api/admin/production/costs { action: 'set_b2b_price', pr_product_id, cents: number | null }
 */
export async function GET(req: NextRequest) {
  return withAdmin(req, async (db) => {
    const [data, raw, shop] = await Promise.all([loadProductionData(db), loadStockRaw(db), db.from('products').select('id, price_cents, active')]);
    if (shop.error) throw new Error(shop.error.message);
    const shopPrice = new Map((shop.data ?? []).map((p) => [p.id, { cents: Number(p.price_cents), active: !!p.active }]));
    const prices = ingredientPrices(raw.deliveries, raw.batches);
    const products: CostRow[] = data.products
      .filter((p) => p.channel === 'intern' || !p.product_id || shopPrice.get(p.product_id)?.active !== false)
      .map((p) => {
        const c = productCost(p, data, prices);
        const web = p.product_id ? shopPrice.get(p.product_id)?.cents ?? null : null;
        return { ...c, web_price_cents: web, web_net_cents: web !== null ? web / 1.07 : null, b2b_net_cents: p.b2b_net_price_cents };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const supplierName = new Map(raw.suppliers.map((s) => [s.id, s.name]));
    const ingName = new Map(data.ingredients.map((i) => [i.id, i]));
    const priceRows: PriceRow[] = [...prices.values()].map((p) => ({ ...p, name: ingName.get(p.ingredient_id)?.name ?? '?', unit: ingName.get(p.ingredient_id)?.unit ?? 'g', supplier: p.source === 'batch' ? 'in-house' : p.supplier_id ? supplierName.get(p.supplier_id) ?? null : null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ products, prices: priceRows });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body?.action !== 'set_b2b_price') return bad('Unknown action.');
  const cents = body.cents === null || body.cents === '' || body.cents === undefined ? null : Number(body.cents);
  if (!body.pr_product_id || (cents !== null && (!Number.isInteger(cents) || cents < 0))) return bad('pr_product_id and cents (whole number ≥ 0 or null) are required.');
  return withAdmin(req, async (db) => {
    const { error } = await db.from('pr_products').update({ b2b_net_price_cents: cents, updated_at: new Date().toISOString() }).eq('id', body.pr_product_id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
