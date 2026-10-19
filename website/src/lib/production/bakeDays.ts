/**
 * Bake days and cut-offs for the production module.
 *
 * DERIVED from the shop, not configured here (owner, 18.10.2026): a bake day
 * is a pickup day — Wednesday and Saturday — and its cut-off is two days
 * before at 22:00 Europe/Berlin, exactly as src/lib/pickup.ts assigns orders.
 * When "Saturday becomes Sunday" that is a shop-wide change, made in the
 * shop's pickup logic first; this file only has to follow it.
 *
 * These are the SHOP bake days. B2B deliveries (step 2) may fall on any
 * weekday (owner, 19.10.2026) — a date with B2B demand is a bake day too; see
 * b2bDays() in b2b.ts. The sheet works for any date.
 */

export const BAKE_WEEKDAYS: { weekday: number; label: string }[] = [
  { weekday: 3, label: 'Wednesday' },
  { weekday: 6, label: 'Saturday' },
];
export const CUTOFF_DAYS_BEFORE = 2;
export const CUTOFF_HOUR = 22;

function berlinNow(now: Date): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
}

export function berlinTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBakeDay(dateISO: string): boolean {
  return BAKE_WEEKDAYS.some((b) => b.weekday === weekdayOf(dateISO));
}

export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Cut-off as a Berlin wall-clock description + whether it has passed. */
export function cutoffInfo(dateISO: string, now: Date = new Date()): { date: string; hour: number; passed: boolean; label: string } {
  const date = addDays(dateISO, -CUTOFF_DAYS_BEFORE);
  const [y, m, d] = date.split('-').map(Number);
  const cutoff = new Date(y, m - 1, d, CUTOFF_HOUR, 0, 0, 0); // in the Berlin frame below
  const b = berlinNow(now);
  return { date, hour: CUTOFF_HOUR, passed: b >= cutoff, label: `${date} ${String(CUTOFF_HOUR).padStart(2, '0')}:00` };
}

/** The next `count` bake days from today (inclusive). */
export function upcomingBakeDays(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  let d = berlinTodayISO(now);
  while (out.length < count) {
    if (isBakeDay(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** The last `count` bake days strictly before today. */
export function recentBakeDays(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  let d = addDays(berlinTodayISO(now), -1);
  while (out.length < count) {
    if (isBakeDay(d)) out.push(d);
    d = addDays(d, -1);
  }
  return out;
}

export function formatDateEN(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
