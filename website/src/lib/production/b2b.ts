/**
 * Step 2 — B2B standing orders, per-date overrides and one-off orders, pure.
 *
 * For a bake day: every active client with an active standing order on that
 * weekday (inside its valid_from/valid_to) is planned; an override for the
 * date either skips the client ("closed") or replaces the item list; one-off
 * orders are added on top. The result feeds computeBakeSheet as demands with
 * source 'b2b' (b2b clients / b2b one-offs) or 'manual' (market, test, own).
 */
import type { B2BClient, DayOverride, Demand, ManualOrder, OrderItem, ProductLink, StandingOrder } from './types';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOfISO(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface PlannedClient {
  client: B2BClient;
  standing: StandingOrder | null;      // the standing order that applies on this weekday (if any)
  override: DayOverride | null;
  skipped: boolean;
  items: OrderItem[];                  // what is delivered this date (empty when skipped)
  source: 'standing' | 'override' | 'none';
}

export function standingApplies(so: StandingOrder, dateISO: string): boolean {
  if (!so.active) return false;
  if (so.weekday !== weekdayOfISO(dateISO)) return false;
  if (so.valid_from && dateISO < so.valid_from) return false;
  if (so.valid_to && dateISO > so.valid_to) return false;
  return true;
}

/**
 * Dates in [from, to] on which B2B work exists (a standing order that applies and
 * is not skipped, or a one-off order). B2B bake days may be ANY weekday (owner,
 * 19.10.2026): they are delivered directly, not picked up, so the shop's
 * Wednesday/Saturday rule does not apply to them.
 */
export function b2bDays(fromISO: string, toISO: string, clients: B2BClient[], standing: StandingOrder[], overrides: DayOverride[], manual: ManualOrder[]): string[] {
  const out: string[] = [];
  const [y, m, d] = fromISO.split('-').map(Number);
  for (let t = Date.UTC(y, m - 1, d); ; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (iso > toISO) break;
    const plan = planB2BDay(iso, clients, standing, overrides, manual);
    if (plan.planned.some((p) => !p.skipped && p.items.length > 0) || plan.manual.some((mo) => mo.items.length > 0)) out.push(iso);
  }
  return out;
}

/** Does the (optional) validity window of a standing order contain its weekday at least once? */
export function rangeHasWeekday(weekday: number, from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  if (to < from) return false;
  const [y, m, d] = from.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 7; i++) {
    const t = new Date(start + i * 86_400_000);
    const iso = t.toISOString().slice(0, 10);
    if (iso > to) return false;
    if (t.getUTCDay() === weekday) return true;
  }
  return true;
}

export function planB2BDay(dateISO: string, clients: B2BClient[], standing: StandingOrder[], overrides: DayOverride[], manual: ManualOrder[]): { planned: PlannedClient[]; manual: ManualOrder[] } {
  const planned: PlannedClient[] = [];
  for (const client of [...clients].sort((a, b) => a.name.localeCompare(b.name))) {
    const override = overrides.find((o) => o.client_id === client.id && o.date === dateISO) ?? null;
    const so = standing.find((s) => s.client_id === client.id && standingApplies(s, dateISO)) ?? null;
    if (!client.active && !override) continue;
    if (!so && !override) continue;
    if (override?.skip) { planned.push({ client, standing: so, override, skipped: true, items: [], source: 'override' }); continue; }
    if (override?.items) { planned.push({ client, standing: so, override, skipped: false, items: clean(override.items), source: 'override' }); continue; }
    if (so) planned.push({ client, standing: so, override, skipped: false, items: clean(so.items), source: 'standing' });
  }
  return { planned, manual: manual.filter((m) => m.date === dateISO) };
}

function clean(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => i.pr_product_id && Number(i.qty) > 0).map((i) => ({ pr_product_id: i.pr_product_id, qty: Number(i.qty) }));
}

/** Demands for computeBakeSheet. Unknown products are kept (as missing-recipe warnings), never dropped. */
export function b2bDemands(plan: { planned: PlannedClient[]; manual: ManualOrder[] }, products: ProductLink[], clients: B2BClient[]): Demand[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const out: Demand[] = [];
  for (const p of plan.planned) {
    for (const it of p.items) {
      out.push({ pr_product_id: byId.has(it.pr_product_id) ? it.pr_product_id : null, product_name: byId.get(it.pr_product_id)?.name ?? 'unknown product', qty: it.qty, source: 'b2b', reason: p.client.name });
    }
  }
  for (const m of plan.manual) {
    const label = m.type === 'b2b' ? (m.client_id ? clientName.get(m.client_id) ?? 'B2B' : m.label || 'B2B') : (m.label ? `${m.type}: ${m.label}` : m.type);
    for (const it of clean(m.items)) {
      out.push({ pr_product_id: byId.has(it.pr_product_id) ? it.pr_product_id : null, product_name: byId.get(it.pr_product_id)?.name ?? 'unknown product', qty: it.qty, source: m.type === 'b2b' ? 'b2b' : 'manual', reason: label });
    }
  }
  return out;
}
