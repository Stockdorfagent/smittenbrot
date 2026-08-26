-- 025: a cancellation declared through the public page waits for review.
--
-- The public /kuendigung form cannot require a login — § 312k BGB is precisely
-- about cancelling being no harder than signing up — so knowing someone's email
-- address is enough to declare a cancellation on their behalf. The owner was
-- rightly uneasy about that.
--
-- The fix is not to obstruct the declaration but to make it reversible. The
-- subscription goes to `cancellation_pending`, which already stops the next
-- order (placement selects status = 'active' only), and the owner confirms or
-- discards it. Nobody is charged either way.
--
-- `cancellation_pending` on its own was not enough: processCancellations runs
-- every 30 minutes and turns pending into cancelled, so there would be no
-- review window worth the name. Hence the resolution columns below, which that
-- job now consults before finalising anything.

alter table public.cancellation_requests
  add column if not exists resolution text
    check (resolution is null or resolution in ('confirmed', 'discarded')),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.customers(id) on delete set null;

comment on column public.cancellation_requests.resolution is
  'NULL = still awaiting review; the subscription sits in cancellation_pending and processCancellations leaves it alone. confirmed = cancel it. discarded = the declaration was not genuine, subscription restored.';

-- Unresolved requests are what the admin list and the engine both look for.
create index if not exists idx_cancellation_requests_open
  on public.cancellation_requests (received_at desc)
  where resolution is null;

/**
 * Subscription ids with a cancellation still awaiting the owner's review.
 *
 * A view rather than a repeated subquery: the engine and the admin both need
 * exactly this set, and they must not drift apart.
 */
create or replace view public.subscriptions_awaiting_cancellation_review as
  select distinct unnest(subscription_ids) as subscription_id
    from public.cancellation_requests
   where resolution is null;

comment on view public.subscriptions_awaiting_cancellation_review is
  'Subscriptions held in cancellation_pending by an unreviewed public cancellation. processCancellations must skip these.';
