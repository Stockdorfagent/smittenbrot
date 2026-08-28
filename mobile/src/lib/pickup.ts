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
  const candidates: { day: PickupDay; date: Date }[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() + i);
    const dow = d.getDay();
    if (dow === 3) candidates.push({ day: 'wednesday', date: d });
    if (dow === 6) candidates.push({ day: 'saturday', date: d });
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
