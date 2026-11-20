export type PickupDay = 'wednesday' | 'saturday';

export interface NextPickup {
  day: PickupDay;
  date: string;        // YYYY-MM-DD (Europe/Berlin calendar date)
  label: string;       // e.g. "Mittwoch, 23. Juli"
  cutoffLabel: string; // e.g. "Bestellschluss: Montag, 22:00 Uhr"
}

/**
 * A Schließzeit (admin → Schließzeiten): no production from start_date to
 * end_date inclusive. Pickup days inside a closure are skipped everywhere a
 * date is derived (shop, cart, checkout, Abo run label) — the server-side
 * checks in create-payment-intent and the subscription engine are the
 * backstop. Since 20.11.2026; before, only the checkout refused the date.
 */
export interface ClosureRange {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD, >= start_date
  banner_text_de?: string | null;
  reason?: string | null;
}

/** True when the calendar date lies inside any closure. */
export function isClosedOn(dateISO: string, closures: readonly ClosureRange[]): boolean {
  return closures.some((c) => c.start_date <= dateISO && dateISO <= c.end_date);
}

/**
 * A Date whose LOCAL fields represent the Europe/Berlin wall-clock time, so
 * getDay()/getHours()/getDate() reflect Berlin regardless of the runtime's
 * own timezone. All pickup math below stays in this single frame.
 */
function berlinNow(now: Date): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
}

/**
 * Today's calendar date (YYYY-MM-DD) in Europe/Berlin — NOT the UTC date:
 * between midnight and 01:00/02:00 Berlin time `toISOString()` still returns
 * yesterday, which is exactly when date-boundary checks go wrong. The server
 * (subscription engine) does all of its date math in Europe/Berlin, so
 * client-side date comparisons must use the same calendar.
 */
export function berlinTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

/**
 * A Berlin calendar date a whole number of days from today (e.g. +1 =
 * tomorrow), as YYYY-MM-DD. Pure calendar arithmetic on the date parts, so
 * DST-length days cannot shift the result the way `Date.now() + 86400000`
 * can.
 */
export function berlinDatePlusDays(days: number, now: Date = new Date()): string {
  const [y, m, d] = berlinTodayISO(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

/**
 * The pickup day is decided by the order cutoff, NOT chosen by the customer:
 *   - Wednesday pickup closes Monday 22:00
 *   - Saturday pickup closes Thursday 22:00  (two days before, at 22:00)
 *
 * An order placed now is assigned to the soonest pickup whose cutoff is still
 * in the future. Shared by the website's shop, cart, product detail and
 * checkout so all of them assign identical dates. The server re-validates.
 * Computed in Europe/Berlin so it is correct irrespective of device timezone.
 */
export function getNextPickup(now: Date = new Date(), closures: readonly ClosureRange[] = []): NextPickup {
  return getNextPickupFor(null, now, closures);
}

/** The weekdays a pickup location serves (pickup_locations.available_wed/_sat). */
export interface PickupDays {
  available_wed: boolean;
  available_sat: boolean;
}

/**
 * Same rule, but for ONE pickup location: the soonest pickup whose cutoff is
 * still open AND which that location serves. Owner's decision 24.09.2026: a
 * customer who picks a Wednesday-only location (AB90, Feichtstr.) on a
 * Thursday simply orders for the next Wednesday — no error, no fallback to
 * another location. `null` (no location yet) = the default twice-weekly rule.
 * A location with neither day set is treated like the default rather than
 * producing no date at all. Pickup days inside a closure are skipped, so
 * during a Backpause the shop simply offers the first bake day after it.
 */
export function getNextPickupFor(
  loc: PickupDays | null | undefined,
  now: Date = new Date(),
  closures: readonly ClosureRange[] = [],
): NextPickup {
  const b = berlinNow(now);
  const wed = loc ? loc.available_wed : true;
  const sat = loc ? loc.available_sat : true;
  const allowWed = wed || (!wed && !sat);
  const allowSat = sat || (!wed && !sat);

  // 70 days: long enough to look past a multi-week closure. The fallback
  // (nothing open at all) is the plain calendar rule, which the server then
  // refuses — better than no date.
  const candidates: { day: PickupDay; date: Date; iso: string }[] = [];
  for (let i = 0; i < 70; i++) {
    const d = new Date(b);
    d.setHours(0, 0, 0, 0);
    d.setDate(b.getDate() + i);
    const dow = d.getDay();
    const iso = toISODate(d);
    if (dow === 3 && allowWed) candidates.push({ day: 'wednesday', date: d, iso });
    if (dow === 6 && allowSat) candidates.push({ day: 'saturday', date: d, iso });
  }

  const cutoffOpen = (c: { date: Date }) => {
    const cutoff = new Date(c.date);
    cutoff.setDate(c.date.getDate() - 2);
    cutoff.setHours(22, 0, 0, 0);
    return b < cutoff;
  };
  const chosen =
    candidates.find((c) => cutoffOpen(c) && !isClosedOn(c.iso, closures)) ??
    candidates.find(cutoffOpen) ??
    candidates[0];

  const date = chosen.iso;
  const label = chosen.date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Cutoff = two days before the pickup, at 22:00 Berlin. A weekday alone is
  // ambiguous once the pickup is more than a week away (a closure skipped the
  // nearer one), so from 7 days out the cutoff carries its date.
  const cutoffDate = new Date(chosen.date);
  cutoffDate.setDate(chosen.date.getDate() - 2);
  const todayStart = new Date(b);
  todayStart.setHours(0, 0, 0, 0);
  const daysAhead = Math.round((cutoffDate.getTime() - todayStart.getTime()) / 86400000);
  const cutoffWeekday = cutoffDate.toLocaleDateString('de-DE', { weekday: 'long' });
  const cutoffLabel = daysAhead === 0
    ? 'Bestellschluss: heute 22:00 Uhr'
    : daysAhead >= 7
      ? `Bestellschluss: ${cutoffWeekday}, ${ddmm(cutoffDate)}, 22:00 Uhr`
      : `Bestellschluss: ${cutoffWeekday}, 22:00 Uhr`;

  return { day: chosen.day, date, label, cutoffLabel };
}

/** YYYY-MM-DD from a Date's LOCAL fields (the Berlin frame used above). */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "30.11." from a Date's local fields. */
function ddmm(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

/** "30.11." from YYYY-MM-DD. */
function ddmmISO(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

// ── Closure banner ──────────────────────────────────────────────────────────

/** The banner announces a closure this many days before it starts. */
export const CLOSURE_ANNOUNCE_DAYS = 14;

/**
 * The closure the site-wide banner should show right now: one that has not
 * ended and starts within CLOSURE_ANNOUNCE_DAYS (or is already running). The
 * soonest one when several qualify. `null` = no banner.
 */
export function announcedClosure(closures: readonly ClosureRange[], todayISO: string): ClosureRange | null {
  const [y, m, d] = todayISO.split('-').map(Number);
  const horizon = new Date(Date.UTC(y, m - 1, d + CLOSURE_ANNOUNCE_DAYS)).toISOString().slice(0, 10);
  const due = closures
    .filter((c) => c.end_date >= todayISO && c.start_date <= horizon)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  return due[0] ?? null;
}

/**
 * First Wednesday/Saturday after `dateISO` that is not inside a closure, as
 * YYYY-MM-DD (cutoffs ignored: this names the next bake day, not what can be
 * ordered right now).
 */
export function firstOpenPickupAfter(dateISO: string, closures: readonly ClosureRange[]): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  for (let i = 1; i <= 70; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    const dow = t.getUTCDay();
    if (dow !== 3 && dow !== 6) continue;
    const iso = t.toISOString().slice(0, 10);
    if (!isClosedOn(iso, closures)) return iso;
  }
  return dateISO;
}

/**
 * The banner text: the owner's own text when set, otherwise a generated one
 * naming the dates and the first bake day after the closure, e.g.
 * "Vom 25.11. bis 01.12. backen wir nicht. Nächster Abholtag: Mittwoch, 02.12."
 */
export function closureBannerText(c: ClosureRange, closures: readonly ClosureRange[]): string {
  const own = (c.banner_text_de ?? '').trim();
  if (own) return own;
  const next = formatPickupDateDe(firstOpenPickupAfter(c.end_date, closures));
  const when = c.start_date === c.end_date
    ? `Am ${ddmmISO(c.start_date)} backen wir nicht.`
    : `Vom ${ddmmISO(c.start_date)} bis ${ddmmISO(c.end_date)} backen wir nicht.`;
  return `${when} Nächster Abholtag: ${next}`;
}

/**
 * Which A/B week a pickup date belongs to. Since 24.09.2026 (migration 032) the
 * `week-cycle` cron toggles week_cycle.current_week every MONDAY at 22:00 Berlin
 * — the Wednesday cutoff — so a cycle week is a Saturday plus the Wednesday
 * after it. That is exactly the pair a Wednesday-only location produces
 * ("next Wednesday" instead of Saturday), so the location shift never changes
 * the cycle any more. Counts the toggles strictly after `now` and strictly
 * before the pickup's own cutoff (two days before, 22:00).
 */
export function weekTypeForPickup(currentWeek: 'A' | 'B', pickupDateISO: string, now: Date = new Date()): 'A' | 'B' {
  const b = berlinNow(now);
  const [y, m, d] = pickupDateISO.split('-').map(Number);
  const cutoff = new Date(y, m - 1, d - 2, 22, 0, 0, 0);
  let flips = 0;
  const t = new Date(b);
  t.setHours(22, 0, 0, 0);
  // Move t to the next Monday 22:00 strictly after now.
  while (t.getDay() !== 1 || t <= b) t.setDate(t.getDate() + 1), t.setHours(22, 0, 0, 0);
  while (t < cutoff) { flips++; t.setDate(t.getDate() + 7); }
  return flips % 2 === 0 ? currentWeek : currentWeek === 'A' ? 'B' : 'A';
}

/** Product fields needed to decide availability on a given pickup date. */
export interface ProductDayAvailability {
  cycle: 'permanent' | 'week_a' | 'week_b' | 'hidden';
  available_wed: boolean;
  available_sat: boolean;
  /** "Wieder ab": not offered for pickup dates before this YYYY-MM-DD. */
  available_from?: string | null;
}

/** True when the product is in the range on that pickup day and in that week. */
export function isProductAvailableOn(p: ProductDayAvailability, pickup: NextPickup, weekForPickup: 'A' | 'B'): boolean {
  if (p.cycle === 'hidden') return false;
  if (pickup.day === 'wednesday' && !p.available_wed) return false;
  if (pickup.day === 'saturday' && !p.available_sat) return false;
  if (p.cycle === 'week_a' && weekForPickup !== 'A') return false;
  if (p.cycle === 'week_b' && weekForPickup !== 'B') return false;
  if (!isOfferedOn(p, pickup.date)) return false;
  return true;
}

/** "Wieder ab" rule alone: offered on the pickup date unless available_from lies after it. */
export function isOfferedOn(p: { available_from?: string | null }, pickupDateISO: string): boolean {
  return !p.available_from || p.available_from <= pickupDateISO;
}

/**
 * When a Dauerbestellung will next be placed. Since 05.10.2026 the engine
 * places AND charges a subscription order at 20:00 on the order day (Monday
 * for Wednesday, Thursday for Saturday); nothing exists before that moment.
 * This names the next such moment for the customer: the first order day
 * (for the subscription's pickup weekday(s)) whose 20:00 is still ahead.
 * Europe/Berlin, like everything else here.
 */
export interface NextSubscriptionRun {
  orderDate: string;   // YYYY-MM-DD of the order day (Mon/Thu)
  pickupDate: string;  // YYYY-MM-DD of the pickup (Wed/Sat)
  label: string;       // e.g. "Montag, 05.10. um 20:00 Uhr · Abholung Mittwoch, 07.10."
}

export function nextSubscriptionRun(
  pickupDay: 'wednesday' | 'saturday' | 'both' | null | undefined,
  now: Date = new Date(),
  closures: readonly ClosureRange[] = [],
): NextSubscriptionRun {
  const b = berlinNow(now);
  const wantWed = pickupDay !== 'saturday';
  const wantSat = pickupDay === 'saturday' || pickupDay === 'both';
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmt = (d: Date) =>
    `${d.toLocaleDateString('de-DE', { weekday: 'long' })}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

  let first: { order: Date; pickup: Date } | null = null;
  for (let i = 0; i < 70 && !first; i++) {
    const pickup = new Date(b);
    pickup.setHours(0, 0, 0, 0);
    pickup.setDate(b.getDate() + i);
    const dow = pickup.getDay();
    if (!((dow === 3 && wantWed) || (dow === 6 && wantSat))) continue;
    // The engine skips closed bake days (no order, no charge), so the next
    // run is the first OPEN pickup's order day.
    if (isClosedOn(iso(pickup), closures)) continue;
    const order = new Date(pickup);
    order.setDate(pickup.getDate() - 2);
    order.setHours(20, 0, 0, 0);
    if (b < order) first = { order, pickup };
  }
  // 70 days always contain an open matching weekday; the fallback only satisfies the type.
  const chosen = first ?? { order: b, pickup: b };
  const sameDay = iso(chosen.order) === iso(b);
  return {
    orderDate: iso(chosen.order),
    pickupDate: iso(chosen.pickup),
    label: `${sameDay ? 'heute' : fmt(chosen.order)} um 20:00 Uhr · Abholung ${fmt(chosen.pickup)}`,
  };
}

/** "Mittwoch, 07.10." for a YYYY-MM-DD pickup date (Europe/Berlin calendar). */
export function formatPickupDateDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const weekday = d.toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' });
  return `${weekday}, ${m[3]}.${m[2]}.`;
}
