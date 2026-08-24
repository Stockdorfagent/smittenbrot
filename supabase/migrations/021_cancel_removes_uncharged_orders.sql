-- 021: cancelling a subscription immediately drops its uncharged order.
--
-- Owner's rule (2026-08-25): "as soon as you cancel, everything relevant to
-- this gets cancelled immediately as well."
--
-- What happened before: the 20:00 job created the order, the customer cancelled
-- at 21:30, and the 22:00 job charged it anyway — because that job selects
-- orders by status/type/date and never looks at the subscription. Cancellation
-- only flipped the subscription's own status. The 12:00 reminder meanwhile
-- promises "Änderungen oder Stornierung sind bis 22:00 Uhr möglich", so the
-- customer was charged inside a window we had told them was still open.
--
-- pauseSubscription() already deletes the not-yet-charged order; cancellation
-- never got the same treatment. This puts the rule in the database so it holds
-- for every caller — app, website, admin or SQL — with no client change.
--
-- Deliberately conservative about what it deletes:
--   * payment_status must not be 'paid'   (money has moved)
--   * invoice_number must be null          (issued paperwork, § 147 AO)
--   * status must still be scheduled/grace_period_open (not locked or fulfilled)
--   * fulfillment_date must not be in the past (leave history alone)

create or replace function public.drop_uncharged_orders_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  doomed uuid[];
begin
  if new.status not in ('cancellation_pending', 'cancelled') then
    return new;
  end if;
  if old.status = new.status then
    return new;  -- nothing changed
  end if;

  select coalesce(array_agg(o.id), '{}')
    into doomed
    from public.orders o
   where o.subscription_id = new.id
     and o.payment_status is distinct from 'paid'
     and o.invoice_number is null
     and o.status in ('scheduled', 'grace_period_open')
     and o.fulfillment_date >= current_date;

  if array_length(doomed, 1) is null then
    return new;
  end if;

  delete from public.order_items where order_id = any(doomed);
  delete from public.orders where id = any(doomed);

  raise notice 'Subscription % cancelled: dropped % uncharged order(s)',
    new.id, array_length(doomed, 1);

  return new;
end;
$$;

drop trigger if exists trg_cancel_drops_uncharged_orders on public.subscriptions;

create trigger trg_cancel_drops_uncharged_orders
  after update of status on public.subscriptions
  for each row
  execute function public.drop_uncharged_orders_on_cancel();
