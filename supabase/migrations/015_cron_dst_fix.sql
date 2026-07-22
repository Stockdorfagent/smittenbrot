-- Smittenbrot — Cron DST fix
-- Run this as SQL in Supabase Dashboard → SQL Editor (project aoryok).
--
-- Problem: pg_cron only understands UTC and rejects CRON_TZ=Europe/Berlin.
-- The jobs were scheduled at the SUMMER (CEST, UTC+2) hour, so in WINTER
-- (CET, UTC+1) every job fired 1h EARLY — the 22:00 lock/charge ran at 21:00
-- Berlin, before the "Bestellschluss 22:00" shown to customers.
--
-- Fix: schedule each time-sensitive job at BOTH the summer and winter UTC
-- hours (list syntax "20,21"). The subscription-engine now has a Berlin-hour
-- guard (berlinHour()), so only the firing that lands on the intended Berlin
-- hour does the work; the other returns {skipped:true} and is a harmless no-op.
--   reminders → Berlin 12:00 (UTC 10 summer / 11 winter)
--   orders    → Berlin 20:00 (UTC 18 summer / 19 winter)
--   lock      → Berlin 22:00 (UTC 20 summer / 21 winter)
--
-- Re-running cron.schedule with an existing job name updates it (upsert).
-- Unchanged: sub-cancellations (*/30, not time-of-day specific) and
-- week-cycle (cosmetic A/B flip; 1h winter drift is harmless and dual-
-- scheduling it without a guard would toggle it twice = no switch).

-- Mon/Thu 12:00 Berlin → Reminder email
SELECT cron.schedule('sub-reminder-mon','0 10,11 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
SELECT cron.schedule('sub-reminder-thu','0 10,11 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Mon/Thu 20:00 Berlin → Auto-place subscription orders
SELECT cron.schedule('sub-order-mon','0 18,19 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
SELECT cron.schedule('sub-order-thu','0 18,19 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Mon/Thu 22:00 Berlin → Lock orders, charge saved cards
SELECT cron.schedule('sub-lock-mon','0 20,21 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
SELECT cron.schedule('sub-lock-thu','0 20,21 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Verify:
-- SELECT jobname, schedule FROM cron.job ORDER BY jobname;
