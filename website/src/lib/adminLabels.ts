/**
 * Admin-facing German wording, one copy.
 *
 * The orders page and the notifications page each carried their own
 * notification maps (already drifted: 'App' vs 'Push', 'Beide' vs
 * 'App + E-Mail'); products and settings each had cycle labels. Customer-facing
 * order wording deliberately stays separate in lib/orderStatus.ts — the owner
 * reads ops language ("Neu"), the customer reads promise language
 * ("Vorgemerkt").
 */

export const notificationTypeLabels: Record<string, string> = {
  order_receipt: 'Bestellbestätigung',
  subscription_reminder: 'Abonnement-Erinnerung',
  order_placed: 'Bestellung aufgegeben',
  pickup_ready: 'Abholbereit',
  payment_failed: 'Zahlung fehlgeschlagen',
  admin_alert: 'Admin-Benachrichtigung',
  closure_notice: 'Schließzeit-Hinweis',
  subscription_paused: 'Abonnement pausiert',
  subscription_cancelled: 'Abonnement gekündigt',
};

export const notificationChannelLabels: Record<string, string> = {
  email: 'E-Mail',
  push: 'App',
  both: 'App + E-Mail',
};

export const orderStatusAdminLabels: Record<string, string> = {
  scheduled: 'Neu',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderungsfenster',
  locked_for_production: 'Für Produktion gesperrt',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

export const paymentStatusLabels: Record<string, string> = {
  pending: 'Ausstehend',
  paid: 'Bezahlt',
  failed: 'Fehlgeschlagen',
  refunded: 'Rückerstattet',
};

export const cycleLabels: Record<string, string> = {
  permanent: 'Immer',
  week_a: 'Woche A',
  week_b: 'Woche B',
  hidden: 'Versteckt',
};
