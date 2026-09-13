-- 029: how an order was paid, for the admin view and exports. Written by the
-- stripe-webhook from the charge's payment_method_details ('card', 'card/apple_pay',
-- 'card/google_pay', 'paypal', …). Null for imported Squarespace orders.
alter table public.orders add column if not exists payment_method text;
comment on column public.orders.payment_method is 'Stripe payment_method_details.type, plus /wallet for Apple/Google Pay';
