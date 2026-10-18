/**
 * Step 2 — freezer counter for stock products, pure.
 *
 * counter          = Σ movements up to and including today's bookings
 * after_today      = counter − usage today (orders delivered from the freezer) + batch confirmed today
 * projected        = after_today − demand on the following bake days up to the next possible production day
 *                    (owner's rule, spec step 2: "freezer 2, deliveries until next brioche day 4 → bake 6 extra")
 * suggestion       = smallest multiple of batch_size that lifts projected to ≥ min_level (0 when fine)
 * Batch age        = FIFO over batch movements; warn when the oldest remaining batch exceeds max_age_days.
 */
import type { ProductLink } from './types';

export interface FreezerSettings { pr_product_id: string; batch_size: number; min_level: number; max_age_days: number | null }
export interface FreezerMovement { id: string; pr_product_id: string; date: string; kind: 'batch' | 'usage' | 'count' | 'manual'; qty: number; note: string | null }
export interface AheadDemand { date: string; pieces: number; who: string }

export interface FreezerStatus {
  pr_product_id: string;
  name: string;
  recipe_id: string | null;         // the dough it is made from (suggestion only when that dough is baked anyway)
  pieces_per_unit: number;          // orders are in units (bags), stock in pieces
  settings: FreezerSettings;
  counter: number;                  // all booked movements (before today's unbooked usage)
  usage_today: number;              // pieces delivered from the freezer today (from the bake sheet)
  usage_booked_today: boolean;
  batch_today: number;              // pieces confirmed as made today (booked)
  extra_today: number;              // pieces in today's extra quantities (planned, maybe not yet confirmed)
  after_today: number;
  ahead: AheadDemand[];
  ahead_total: number;
  projected: number;
  suggestion: number;               // pieces to make (multiple of batch_size), 0 = nothing needed
  oldest_batch_date: string | null;
  oldest_batch_age_days: number | null;
  too_old: boolean;
}

export function counterOf(movements: FreezerMovement[]): number {
  return movements.reduce((n, m) => n + Number(m.qty), 0);
}

export function suggestBatch(projected: number, minLevel: number, batchSize: number): number {
  if (projected >= minLevel) return 0;
  const need = minLevel - projected;
  const size = batchSize > 0 ? batchSize : 1;
  return Math.ceil(need / size - 1e-9) * size;
}

/** FIFO: the date of the oldest batch that still has pieces in stock. */
export function oldestRemainingBatch(movements: FreezerMovement[]): string | null {
  const batches = movements.filter((m) => m.kind === 'batch' || (m.kind !== 'usage' && Number(m.qty) > 0)).sort((a, b) => a.date.localeCompare(b.date));
  let consumed = -movements.filter((m) => Number(m.qty) < 0).reduce((n, m) => n + Number(m.qty), 0);
  for (const b of batches) {
    const q = Number(b.qty);
    if (consumed >= q) { consumed -= q; continue; }
    return b.date;
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function freezerStatus(
  product: ProductLink, settings: FreezerSettings, movements: FreezerMovement[], date: string,
  usageToday: number, extraToday: number, ahead: AheadDemand[],
): FreezerStatus {
  const booked = movements.filter((m) => m.date <= date);
  const usageRow = booked.find((m) => m.kind === 'usage' && m.date === date);
  const batchRow = booked.find((m) => m.kind === 'batch' && m.date === date);
  const counter = counterOf(booked.filter((m) => !(m.date === date && (m.kind === 'usage' || m.kind === 'batch'))));
  const batchToday = batchRow ? Number(batchRow.qty) : 0;
  const afterToday = counter - usageToday + batchToday;
  const aheadTotal = ahead.reduce((n, a) => n + a.pieces, 0);
  const projected = afterToday - aheadTotal;
  const oldest = oldestRemainingBatch(booked);
  const age = oldest ? daysBetween(oldest, date) : null;
  return {
    pr_product_id: product.id, name: product.name, recipe_id: product.recipe_id, pieces_per_unit: product.pieces_per_unit ? Number(product.pieces_per_unit) : 1,
    settings, counter, usage_today: usageToday, usage_booked_today: !!usageRow, batch_today: batchToday, extra_today: extraToday,
    after_today: afterToday, ahead, ahead_total: aheadTotal, projected,
    suggestion: suggestBatch(projected + (batchToday ? 0 : extraToday), Number(settings.min_level), Number(settings.batch_size)),
    oldest_batch_date: oldest, oldest_batch_age_days: age,
    too_old: settings.max_age_days !== null && age !== null && age > settings.max_age_days,
  };
}
