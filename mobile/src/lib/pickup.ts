import type { PickupDay } from '@/lib/types';

export interface NextPickup {
  day: PickupDay;
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Mittwoch, 23. Juli"
  cutoffLabel: string; // e.g. "Bestellschluss: Montag, 22:00 Uhr"
}

// Hardcoded German names — NO Intl/toLocaleString. React Native's Hermes
// engine does not reliably support locale formatting or timeZone conversion,
// so we format manually. Times use the device clock (Germany-only ⇒ Berlin).
const WEEKDAYS = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/**
 * The DEVICE-local calendar date as YYYY-MM-DD, formatted manually (no Intl,
 * see above). Never use toISOString() for a calendar date — that is the UTC
 * date, i.e. still yesterday between midnight and ~02:00 German time.
 */
export function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The pickup day is decided by the order cutoff, NOT chosen by the customer:
 *   - Wednesday pickup closes Monday 22:00
 *   - Saturday pickup closes Thursday 22:00  (two days before, at 22:00)
 *
 * An order placed now is assigned to the soonest pickup whose cutoff is still
 * in the future. Uses the device clock (no timezone conversion — see note above).
 */
export function getNextPickup(now: Date = new Date()): NextPickup {
  return getNextPickupFor(null, now);
}

/** The weekdays a pickup location serves (pickup_locations.available_wed/_sat). */
export interface PickupDays {
  available_wed: boolean;
  available_sat: boolean;
}

/**
 * Same rule for ONE location: the soonest pickup whose cutoff is still open AND
 * which that location serves (owner 24.09.2026: AB90/Feichtstr. picked on a
 * Thursday = order for next Wednesday, no error). `null` = default rule.
 */
export function getNextPickupFor(loc: PickupDays | null | undefined, now: Date = new Date()): NextPickup {
  const wed = loc ? loc.available_wed : true;
  const sat = loc ? loc.available_sat : true;
  const allowWed = wed || (!wed && !sat);
  const allowSat = sat || (!wed && !sat);
  const candidates: { day: PickupDay; date: Date }[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() + i);
    const dow = d.getDay();
    if (dow === 3 && allowWed) candidates.push({ day: 'wednesday', date: d });
    if (dow === 6 && allowSat) candidates.push({ day: 'saturday', date: d });
  }

  let chosen = candidates[0];
  for (const c of candidates) {
    const cutoff = new Date(c.date);
    cutoff.setDate(c.date.getDate() - 2);
    cutoff.setHours(22, 0, 0, 0);
    if (now < cutoff) {
      chosen = c;
      break;
    }
  }

  const date =
    `${chosen.date.getFullYear()}-` +
    `${String(chosen.date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(chosen.date.getDate()).padStart(2, '0')}`;
  const label = `${WEEKDAYS[chosen.date.getDay()]}, ${chosen.date.getDate()}. ${MONTHS[chosen.date.getMonth()]}`;

  // Cutoff = two days before the pickup, at 22:00.
  const cutoffDate = new Date(chosen.date);
  cutoffDate.setDate(chosen.date.getDate() - 2);
  const isToday =
    cutoffDate.getFullYear() === now.getFullYear() &&
    cutoffDate.getMonth() === now.getMonth() &&
    cutoffDate.getDate() === now.getDate();
  const cutoffLabel = isToday
    ? 'Bestellschluss: heute 22:00 Uhr'
    : `Bestellschluss: ${WEEKDAYS[cutoffDate.getDay()]}, 22:00 Uhr`;

  return { day: chosen.day, date, label, cutoffLabel };
}

/**
 * A/B week of a pickup date. Since 24.09.2026 the server toggles
 * week_cycle.current_week every MONDAY 22:00 (= Wednesday cutoff), so a cycle
 * week is a Saturday + the Wednesday after it — the pair a Wednesday-only
 * location produces. Counts the toggles strictly after `now` and strictly
 * before the pickup's cutoff.
 */
export function weekTypeForPickup(currentWeek: 'A' | 'B', pickupDateISO: string, now: Date = new Date()): 'A' | 'B' {
  const [y, m, d] = pickupDateISO.split('-').map(Number);
  const cutoff = new Date(y, m - 1, d - 2, 22, 0, 0, 0);
  let flips = 0;
  const t = new Date(now);
  t.setHours(22, 0, 0, 0);
  while (t.getDay() !== 1 || t <= now) { t.setDate(t.getDate() + 1); t.setHours(22, 0, 0, 0); }
  while (t < cutoff) { flips++; t.setDate(t.getDate() + 7); }
  return flips % 2 === 0 ? currentWeek : currentWeek === 'A' ? 'B' : 'A';
}

export interface ProductDayAvailability {
  cycle: 'permanent' | 'week_a' | 'week_b' | 'hidden';
  available_wed: boolean;
  available_sat: boolean;
}

/** True when the product is in the range on that pickup day and in that week. */
export function isProductAvailableOn(p: ProductDayAvailability, pickup: NextPickup, weekForPickup: 'A' | 'B'): boolean {
  if (p.cycle === 'hidden') return false;
  if (pickup.day === 'wednesday' && !p.available_wed) return false;
  if (pickup.day === 'saturday' && !p.available_sat) return false;
  if (p.cycle === 'week_a' && weekForPickup !== 'A') return false;
  if (p.cycle === 'week_b' && weekForPickup !== 'B') return false;
  return true;
}

/**
 * When a Dauerbestellung will next be placed. Since 05.10.2026 the engine
 * places AND charges a subscription order at 20:00 on the order day (Monday
 * for Wednesday, Thursday for Saturday); nothing exists before that moment.
 * This names the next such moment for the customer: the first order day
 * (for the subscription's pickup weekday(s)) whose 20:00 is still ahead.
 * Device clock, Germany-only, like the rest of this file.
 */
export interface NextSubscriptionRun {
  orderDate: string;   // YYYY-MM-DD of the order day (Mon/Thu)
  pickupDate: string;  // YYYY-MM-DD of the pickup (Wed/Sat)
  label: string;       // e.g. "Montag, 05.10. um 20:00 Uhr · Abholung Mittwoch, 07.10."
}

export function nextSubscriptionRun(
  pickupDay: 'wednesday' | 'saturday' | 'both' | null | undefined,
  now: Date = new Date(),
): NextSubscriptionRun {
  const wantWed = pickupDay !== 'saturday';
  const wantSat = pickupDay === 'saturday' || pickupDay === 'both';
  const fmt = (d: Date) =>
    `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

  let first: { order: Date; pickup: Date } | null = null;
  for (let i = 0; i < 21 && !first; i++) {
    const pickup = new Date(now);
    pickup.setHours(0, 0, 0, 0);
    pickup.setDate(now.getDate() + i);
    const dow = pickup.getDay();
    if (!((dow === 3 && wantWed) || (dow === 6 && wantSat))) continue;
    const order = new Date(pickup);
    order.setDate(pickup.getDate() - 2);
    order.setHours(20, 0, 0, 0);
    if (now < order) first = { order, pickup };
  }
  // 21 days always contain a matching weekday; the fallback only satisfies the type.
  const chosen = first ?? { order: now, pickup: now };
  const sameDay = localDateISO(chosen.order) === localDateISO(now);
  return {
    orderDate: localDateISO(chosen.order),
    pickupDate: localDateISO(chosen.pickup),
    label: `${sameDay ? 'heute' : fmt(chosen.order)} um 20:00 Uhr · Abholung ${fmt(chosen.pickup)}`,
  };
}

/** "Mittwoch, 07.10." for a YYYY-MM-DD pickup date (no Intl, see above). */
export function formatPickupDateDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return `${WEEKDAYS[d.getDay()]}, ${m[3]}.${m[2]}.`;
}
