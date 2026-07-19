export type PickupDay = 'wednesday' | 'saturday';

export interface NextPickup {
  day: PickupDay;
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Mittwoch, 23. Juli"
}

/**
 * The pickup day is decided by the order cutoff, NOT chosen by the customer:
 *   - Wednesday pickup closes Monday 22:00
 *   - Saturday pickup closes Thursday 22:00  (two days before, at 22:00)
 *
 * An order placed now is assigned to the soonest pickup whose cutoff is still
 * in the future. This mirrors the mobile app's `getNextPickup()` so both
 * frontends assign identical fulfillment dates. The server re-validates; this
 * drives the client display + the fulfillment_date sent to checkout.
 *
 * NOTE: runs client-side (in the browser) so it uses the customer's device
 * timezone — matching the app. A stricter Europe/Berlin server-side cutoff
 * validation is a separate launch-hardening item.
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
  const label = chosen.date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return { day: chosen.day, date, label };
}
