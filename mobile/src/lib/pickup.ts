import type { PickupDay } from '@/lib/types';

export interface NextPickup {
  day: PickupDay;
  date: string; // YYYY-MM-DD (Europe/Berlin calendar date)
  label: string; // e.g. "Mittwoch, 23. Juli"
  cutoffLabel: string; // e.g. "Bestellschluss: Montag, 22:00 Uhr"
}

/**
 * A Date whose LOCAL fields represent Europe/Berlin wall-clock time, so the
 * pickup math is correct regardless of device timezone.
 */
function berlinNow(now: Date): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
}

/**
 * The pickup day is decided by the order cutoff, NOT chosen by the customer:
 *   - Wednesday pickup closes Monday 22:00
 *   - Saturday pickup closes Thursday 22:00  (two days before, at 22:00)
 *
 * An order placed now is assigned to the soonest pickup whose cutoff is still
 * in the future. Kept identical to the website's lib/pickup.ts so app and
 * website show the same dates and wording.
 */
export function getNextPickup(now: Date = new Date()): NextPickup {
  const b = berlinNow(now);

  const candidates: { day: PickupDay; date: Date }[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(b);
    d.setHours(0, 0, 0, 0);
    d.setDate(b.getDate() + i);
    const dow = d.getDay();
    if (dow === 3) candidates.push({ day: 'wednesday', date: d });
    if (dow === 6) candidates.push({ day: 'saturday', date: d });
  }

  let chosen = candidates[0];
  for (const c of candidates) {
    const cutoff = new Date(c.date);
    cutoff.setDate(c.date.getDate() - 2);
    cutoff.setHours(22, 0, 0, 0);
    if (b < cutoff) {
      chosen = c;
      break;
    }
  }

  const date =
    `${chosen.date.getFullYear()}-` +
    `${String(chosen.date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(chosen.date.getDate()).padStart(2, '0')}`;
  const label = chosen.date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Cutoff = two days before the pickup, at 22:00 Berlin.
  const cutoffDate = new Date(chosen.date);
  cutoffDate.setDate(chosen.date.getDate() - 2);
  const isToday =
    cutoffDate.getFullYear() === b.getFullYear() &&
    cutoffDate.getMonth() === b.getMonth() &&
    cutoffDate.getDate() === b.getDate();
  const cutoffWeekday = cutoffDate.toLocaleDateString('de-DE', { weekday: 'long' });
  const cutoffLabel = isToday
    ? 'Bestellschluss: heute 22:00 Uhr'
    : `Bestellschluss: ${cutoffWeekday}, 22:00 Uhr`;

  return { day: chosen.day, date, label, cutoffLabel };
}
