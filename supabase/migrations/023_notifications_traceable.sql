-- 023: make a notification traceable to the order it was about.
--
-- The problem, in the owner's words: a tester said he had ordered and received
-- no email. The order is visible in the admin, but the Benachrichtigungen list
-- shows only a type and a timestamp — no order, no customer — so the two lists
-- have nothing in common and the question "did THIS order get its email?"
-- cannot be answered.
--
-- It is not merely inconvenient. While investigating, matching receipts to
-- orders by timestamp gave two false positives straight away: subscription
-- orders are charged (and their receipt sent) at the 22:00 run, up to three
-- days after the order was created, so any time window either misses them or
-- catches the wrong order when someone ordered twice in a minute.
--
-- Two columns:
--   order_id            — the actual link, filled in going forward.
--   provider_message_id — Brevo's message id. `delivered` only means Brevo
--                         accepted the mail; it says nothing about inboxes or
--                         spam folders. With the id, a "no email arrived"
--                         report can be traced in Brevo's own log.

alter table public.notifications
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists provider_message_id text;

comment on column public.notifications.order_id is
  'The order this notification was about, where one applies. NULL for order-independent messages (subscription reminders, cancellations) and for anything sent before 2026-08-26.';
comment on column public.notifications.provider_message_id is
  'Brevo messageId for emails — use it to check actual delivery, since `delivered` only records that Brevo accepted the message.';

create index if not exists idx_notifications_order on public.notifications(order_id);

-- ── Best-effort backfill ───────────────────────────────────────────────────
--
-- Only where the match is UNAMBIGUOUS. A wrong link is worse than none: it
-- would answer "yes, that order was notified" about the wrong order.
--
-- Receipts for one-time orders: payment happens within seconds of the order
-- being created, so the order's own created_at is the anchor.
with candidates as (
  select n.id as notification_id,
         (array_agg(o.id order by abs(extract(epoch from (n.sent_at - o.created_at))))) as order_ids,
         count(*) as matches
    from public.notifications n
    join public.orders o
      on o.customer_id = n.customer_id
     and o.order_type = 'one_time'
     and o.payment_status = 'paid'
     and n.sent_at between o.created_at - interval '2 minutes'
                       and o.created_at + interval '10 minutes'
   where n.type = 'order_receipt'
     and n.order_id is null
   group by n.id
)
update public.notifications n
   set order_id = c.order_ids[1]
  from candidates c
 where n.id = c.notification_id
   and c.matches = 1;

-- Receipts for subscription orders: the charge is audited per order, so the
-- audit row is a far better anchor than the order's creation time.
with candidates as (
  select n.id as notification_id,
         (array_agg(a.entity_id order by abs(extract(epoch from (n.sent_at - a.created_at))))) as order_ids,
         count(*) as matches
    from public.notifications n
    join public.audit_log a
      on a.action = 'subscription_payment_captured'
     and a.entity_type = 'order'
     and n.sent_at between a.created_at - interval '2 minutes'
                       and a.created_at + interval '10 minutes'
    join public.orders o
      on o.id = a.entity_id
     and o.customer_id = n.customer_id
   where n.type = 'order_receipt'
     and n.order_id is null
   group by n.id
)
update public.notifications n
   set order_id = c.order_ids[1]
  from candidates c
 where n.id = c.notification_id
   and c.matches = 1;

-- Collection notices: orders.pickup_ready_at was added in 022 and is stamped at
-- send time, which makes it an exact anchor wherever it exists.
with candidates as (
  select n.id as notification_id,
         (array_agg(o.id order by abs(extract(epoch from (n.sent_at - o.pickup_ready_at))))) as order_ids,
         count(*) as matches
    from public.notifications n
    join public.orders o
      on o.customer_id = n.customer_id
     and o.pickup_ready_at is not null
     and n.sent_at between o.pickup_ready_at - interval '2 minutes'
                       and o.pickup_ready_at + interval '2 minutes'
   where n.type = 'pickup_ready'
     and n.order_id is null
   group by n.id
)
update public.notifications n
   set order_id = c.order_ids[1]
  from candidates c
 where n.id = c.notification_id
   and c.matches = 1;
