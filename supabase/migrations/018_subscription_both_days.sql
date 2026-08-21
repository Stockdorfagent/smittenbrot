-- 018: Abos can run on Wednesday, Saturday, or BOTH — and each pickup
--      location decides which days it offers at all.
--
-- Owner (2026-08-21): only Waldstr. ever has a Saturday pickup; Feichtstr. and
-- AB90 are Wednesday-only, and picking Saturday there should be impossible
-- rather than merely discouraged. A Wed+Sa Abo means the SAME basket on both
-- days (two orders, two charges per week) — a different basket per day is a
-- second Abo, by design.
--
-- Day availability is modelled per location instead of hardcoding "Waldstr.",
-- mirroring products.available_wed / available_sat, so the owner can tick a box
-- when a location starts or stops offering a day.

-- 1. Allow 'both' as a subscription pickup day.
alter table public.subscriptions
  drop constraint if exists subscriptions_pickup_day_check;

alter table public.subscriptions
  add constraint subscriptions_pickup_day_check
  check (pickup_day in ('wednesday', 'saturday', 'both'));

-- 2. Per-location day availability. Saturday defaults to false: it is the
--    exception, and defaulting it on would silently offer Saturdays at every
--    future location.
alter table public.pickup_locations
  add column if not exists available_wed boolean not null default true;

alter table public.pickup_locations
  add column if not exists available_sat boolean not null default false;

-- 3. Today only the Waldstr. cabinet has Saturday pickups.
update public.pickup_locations
   set available_sat = true
 where name ilike '%waldstr%';

-- 4. Safety net: a location must offer at least one day, otherwise it could
--    never be chosen for an Abo at all.
alter table public.pickup_locations
  drop constraint if exists pickup_locations_has_a_day;

alter table public.pickup_locations
  add constraint pickup_locations_has_a_day
  check (available_wed or available_sat);
