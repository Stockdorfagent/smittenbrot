/**
 * Order status wording, shared by the customer-facing order list and the
 * order/invoice page.
 *
 * It lives in one place because the two pages had drifted apart from each
 * other and from the app, and a customer who checks the same order on their
 * phone and in a browser should not be told two different things.
 */

import { berlinTodayISO } from './pickup';

/** A `scheduled` order that is already paid is confirmed, not merely planned. */
type StatusInput = {
  status: string;
  payment_status: string;
  fulfillment_date: string;
  pickup_ready_at?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Vorgemerkt',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderbar',
  locked_for_production: 'In Produktion',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

/**
 * Is the bread waiting in the cabinet?
 *
 * `pickup_ready_at` is stamped when the "abholbereit" notice is sent. It is
 * deliberately not an order status of its own — see the date rule below for
 * why `fulfilled` cannot be trusted to mean "collected" on the pickup day.
 */
export function isReadyForPickup(order: StatusInput): boolean {
  if (!order.pickup_ready_at) return false;
  if (order.status === 'cancelled' || order.status === 'refunded') return false;
  // The admin button announces readiness and ticks the order off as
  // `fulfilled` in one click, so on the pickup day `fulfilled` means
  // "announced", not "collected". Ready for the rest of that day; collected
  // from the next day on. ISO dates compare lexically.
  return order.fulfillment_date >= berlinTodayISO();
}

/**
 * What to call this order's state, in the customer's words.
 *
 * Ready for collection wins over everything else, because it is the only state
 * that asks something of the customer.
 */
export function orderStatusLabel(order: StatusInput): string {
  if (isReadyForPickup(order)) return 'Abholbereit';
  // Matches the app: a paid order labelled "Vorgemerkt" next to a subscription
  // order reading "In Produktion" made a tester ask which one was real.
  if (order.status === 'scheduled' && order.payment_status === 'paid') return 'Bestätigt';
  return STATUS_LABELS[order.status] ?? order.status;
}

/** Tailwind classes for the status pill. */
export function orderStatusClasses(order: StatusInput): string {
  // Solid brand red, white text — the one badge meant to be spotted at a
  // glance. The rest keep the conventional semantic colours.
  if (isReadyForPickup(order)) return 'bg-smitten-primary text-white';
  if (order.status === 'fulfilled') return 'bg-green-100 text-green-700';
  if (order.status === 'cancelled' || order.status === 'refunded') return 'bg-red-100 text-red-700';
  if (order.status === 'locked_for_production') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}
