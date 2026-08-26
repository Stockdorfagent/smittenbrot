-- 022: record WHEN an order was announced as ready for collection.
--
-- There is no 'ready' order status: the owner marks an order `fulfilled` only
-- once it has actually been collected (it doubles as her packing checklist),
-- so between "bread is in the cabinet" and "customer took it" the order still
-- reads `locked_for_production`. The only trace that the customer was told was
-- a row in `notifications`, which carries no order_id — so nothing could ask
-- "is MY order ready?".
--
-- That question now matters: notifications go to the app first and the email
-- only follows if the push failed, so a customer whose notifications are
-- switched off needs to be able to SEE the ready state when they open the app.
alter table public.orders
  add column if not exists pickup_ready_at timestamptz;

comment on column public.orders.pickup_ready_at is
  'Set when the "abholbereit" notification for this order was sent. NULL = not yet announced. Not a status: the order stays locked_for_production until collected.';

-- Reading it needs no new policy: the existing orders_self / orders_admin
-- policies already cover every column of the row.
