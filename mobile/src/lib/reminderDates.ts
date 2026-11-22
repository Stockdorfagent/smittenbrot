import { isClosedOn, localDateISO } from './pickup';
import type { ClosureRange } from './pickup';

/**
 * Which concrete dates a personal order reminder should fire on (owner, 22.11.2026).
 *
 * The reminder used to be ONE repeating weekly notification on the device, which
 * fires through a Schließzeit as well ("don't forget to order" for a day nobody
 * bakes — a customer got one on 22.11. for the closed 25.11.). Now the app
 * schedules single dated notifications for the next weeks and leaves out every
 * occurrence whose order would be for a closed pickup day. Recomputed whenever
 * the closures are (re)read, so a closure entered later is picked up on the
 * next app start.
 *
 * Pure: no notifications, no storage. Device-local time (Germany only).
 */

export interface SlotTime {
  weekday: number; // 1 = Sunday … 7 = Saturday (expo/Apple convention)
  hour: number;
  minute: number;
}

/** How many weeks ahead the dated reminders are scheduled (iOS allows 64 pending local notifications per app; 8 weeks × a few slots stays far below). */
export const REMINDER_WEEKS = 8;

/**
 * The pickup an order placed at `t` would be assigned to: the first Wednesday or
 * Saturday whose cutoff (two days before, 22:00) is still ahead of `t`.
 * Same rule as getNextPickupFor, without the closure skip — here a closed
 * pickup means "no reminder", not "remind for the one after".
 */
export function pickupForOrderAt(t: Date): string {
  for (let i = 0; i < 10; i++) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i, 12, 0, 0, 0);
    const wd = d.getDay();
    if (wd !== 3 && wd !== 6) continue;
    const cutoff = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2, 22, 0, 0, 0);
    if (t < cutoff) return localDateISO(d);
  }
  return localDateISO(t); // unreachable: there is always a Wed/Sat within 10 days
}

/**
 * The next `weeks` occurrences of the slot after `now`, as local Dates, with
 * those dropped whose pickup day lies in a closure.
 */
export function reminderDates(slot: SlotTime, closures: readonly ClosureRange[], now: Date = new Date(), weeks = REMINDER_WEEKS): Date[] {
  const out: Date[] = [];
  const targetDay = slot.weekday - 1; // JS getDay(): 0 = Sunday
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slot.hour, slot.minute, 0, 0);
  first.setDate(first.getDate() + ((targetDay - first.getDay() + 7) % 7));
  if (first <= now) first.setDate(first.getDate() + 7);
  for (let w = 0; w < weeks; w++) {
    const at = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * w, slot.hour, slot.minute, 0, 0);
    if (!isClosedOn(pickupForOrderAt(at), closures)) out.push(at);
  }
  return out;
}
