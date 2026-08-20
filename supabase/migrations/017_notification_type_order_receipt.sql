-- 017: allow the notification type 'order_receipt'.
--
-- The receipt/invoice email (stripe-webhook sendReceiptEmail, and the
-- subscription charge receipt in subscription-engine) went straight to Brevo
-- without recording anything, so a failure left no trace: the card was charged
-- and nobody could tell that the invoice never arrived. Edge-function console
-- logs are short-lived and not queryable after the fact.
--
-- Both functions now log every attempt to `notifications`, but the existing
-- CHECK constraint rejected the new type (the insert failed silently, which is
-- how this was caught). 'order_placed' already exists but is used elsewhere, so
-- keep receipt outcomes distinguishable.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type = any (array[
      'subscription_reminder',
      'order_placed',
      'order_receipt',
      'pickup_ready',
      'payment_failed',
      'admin_alert',
      'closure_notice',
      'subscription_paused',
      'subscription_cancelled'
    ])
  );
