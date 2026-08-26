/**
 * How an order's state is described to the customer.
 *
 * Kept in one module because the home screen, the order list and the order
 * detail all answer the same question, and because the website has a matching
 * file — a customer who checks the same order on their phone and in a browser
 * must not be told two different things.
 */

export interface StatusInput {
  status: string;
  payment_status?: string;
  fulfillment_date: string;
  pickup_ready_at?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Vorgemerkt',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderbar',
  locked_for_production: 'In Produktion',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

/** Today in Berlin as YYYY-MM-DD. Germany-only, and Hermes has no Intl. */
function todayISO(): string {
  const now = new Date();
  return (
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}`
  );
}

/**
 * Is the bread waiting in the cabinet right now?
 *
 * `pickup_ready_at` is stamped when the "abholbereit" notice goes out. The
 * catch is that the admin button sends that notice and ticks the order off as
 * `fulfilled` in the same click, so `fulfilled` means "announced" on the pickup
 * day itself and only really means "collected" afterwards. Hence the date
 * check: ready for the rest of the pickup day, collected from the next day on.
 *
 * This is the visible counterpart to the push notification. Notifications go
 * to the app first and only fall back to email if the push fails, so someone
 * with notifications switched off needs to be able to see this by opening the
 * app.
 */
export function isReadyForPickup(order: StatusInput): boolean {
  if (!order.pickup_ready_at) return false;
  if (order.status === 'cancelled' || order.status === 'refunded') return false;
  return order.fulfillment_date >= todayISO(); // ISO dates compare lexically
}

/**
 * Ready for collection outranks every other state — it is the only one that
 * asks something of the customer.
 */
export function orderStatusLabel(order: StatusInput): string {
  if (isReadyForPickup(order)) return 'Abholbereit';
  // A paid order labelled "Vorgemerkt" beside a subscription order reading
  // "In Produktion" made a tester ask which of the two was real.
  if (order.status === 'scheduled' && order.payment_status === 'paid') return 'Bestätigt';
  return STATUS_LABELS[order.status] ?? order.status;
}
