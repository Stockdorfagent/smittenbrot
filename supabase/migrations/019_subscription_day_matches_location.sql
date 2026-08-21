-- 019: refuse a subscription whose pickup day its location does not serve.
--
-- Migration 018 put the day flags on pickup_locations and both clients now hide
-- impossible options. This is the belt-and-braces the owner asked for
-- ("just to make everything watertight"): a Saturday Abo at a Wednesday-only
-- location would otherwise still be insertable via the API, and the engine
-- would happily generate Saturday orders for a location that has no Saturday.
--
-- A CHECK constraint cannot look at another table, so it has to be a trigger.
-- Verified before applying: no existing subscription violates this.

create or replace function public.check_subscription_day_location()
returns trigger
language plpgsql
as $$
declare
  wed boolean;
  sat boolean;
  loc_name text;
begin
  -- Cancelled subscriptions are history; never block cleanup or cancellation.
  if new.status = 'cancelled' then
    return new;
  end if;

  if new.pickup_location_id is null then
    return new;
  end if;

  select available_wed, available_sat, name
    into wed, sat, loc_name
    from public.pickup_locations
   where id = new.pickup_location_id;

  if not found then
    return new; -- the foreign key already handles unknown locations
  end if;

  if new.pickup_day = 'wednesday' and not wed then
    raise exception 'Abholort "%" hat keine Abholung am Mittwoch', loc_name;
  elsif new.pickup_day = 'saturday' and not sat then
    raise exception 'Abholort "%" hat keine Abholung am Samstag', loc_name;
  elsif new.pickup_day = 'both' and not (wed and sat) then
    raise exception 'Abholort "%" bietet nicht beide Abholtage an', loc_name;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_subscription_day_location on public.subscriptions;

create trigger trg_subscription_day_location
  before insert or update of pickup_day, pickup_location_id, status
  on public.subscriptions
  for each row
  execute function public.check_subscription_day_location();
