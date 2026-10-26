/**
 * Pure money helpers for the per-payout export (no Stripe, no DB) so they can
 * be unit-tested with `npm run test:payouts`.
 *
 * All amounts are integer cents. A "split" is the gross of an order per VAT
 * rate (7 / 19 / other). Rounding uses the largest-remainder method so the
 * parts ALWAYS add up to the whole — a bookkeeping file must never be a cent
 * off because of two independent roundings.
 */

export type RateKey = 7 | 19;
export type GrossSplit = { 7: number; 19: number; other: number };

export const emptySplit = (): GrossSplit => ({ 7: 0, 19: 0, other: 0 });

/** 0.07 → 7, 0.19 → 19, anything else → null (goes to `other`). */
export function rateKey(vatRate: number | string | null | undefined): RateKey | null {
  const pct = Math.round(Number(vatRate ?? NaN) * 100);
  return pct === 7 ? 7 : pct === 19 ? 19 : null;
}

/**
 * Distribute `total` over the keys of `weights` proportionally, in whole cents,
 * so the result sums exactly to `total`. Negative totals (refunds) keep the
 * proportions and the sign. Zero weights → everything goes to `fallback`.
 */
export function apportion<K extends string | number>(
  total: number,
  weights: Record<K, number>,
  fallback: NoInfer<K>,
): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const weightSum = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  if (total === 0) return out;
  if (weightSum <= 0) { out[fallback] = total; return out; }

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = keys.map((k) => ({ k, exact: (abs * Math.max(0, weights[k])) / weightSum }));
  let assigned = 0;
  for (const r of raw) { const f = Math.floor(r.exact); out[r.k] = f; assigned += f; }
  let remainder = abs - assigned;
  // Hand the leftover cents to the largest fractional parts first.
  for (const r of [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))) {
    if (remainder <= 0) break;
    out[r.k] += 1; remainder -= 1;
  }
  for (const k of keys) out[k] = out[k] * sign || 0; // `|| 0` turns -0 into 0
  return out;
}

export type OrderItemLike = { quantity: number; unit_price_gross_cents?: number | null; unit_price_cents: number; vat_rate: number | string | null };

/**
 * Gross per VAT rate for an order. The line items carry the UNDISCOUNTED gross
 * (the DB trigger recomputes totals from them); `orderTotal` is what was
 * actually charged (discount already applied). When they differ the discount is
 * spread over the rates proportionally, so the split sums to `orderTotal`.
 */
export function orderGrossSplit(items: OrderItemLike[], orderTotal: number): GrossSplit {
  const byRate = emptySplit();
  for (const it of items) {
    const unit = it.unit_price_gross_cents ?? it.unit_price_cents;
    const gross = unit * it.quantity;
    const key = rateKey(it.vat_rate);
    if (key === null) byRate.other += gross; else byRate[key] += gross;
  }
  const itemsSum = byRate[7] + byRate[19] + byRate.other;
  if (itemsSum === orderTotal) return byRate;
  const scaled = apportion(orderTotal, { 7: byRate[7], 19: byRate[19], other: byRate.other }, 7);
  return { 7: scaled[7], 19: scaled[19], other: scaled.other };
}

/**
 * Split a transaction amount (charge +, refund −) the way its order's gross
 * splits. A partial refund keeps the order's 7/19 proportions.
 */
export function splitTransactionAmount(amount: number, orderSplit: GrossSplit | null): GrossSplit | null {
  if (!orderSplit) return null;
  const s = apportion(amount, { 7: orderSplit[7], 19: orderSplit[19], other: orderSplit.other }, 7);
  return { 7: s[7], 19: s[19], other: s.other };
}

/** German number: 1234 → "12,34"; -5 → "-0,05". */
export const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
