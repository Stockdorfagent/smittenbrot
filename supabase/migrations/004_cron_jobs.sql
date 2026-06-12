-- Smittenbrot Cron Jobs
-- Run these as SQL in Supabase Dashboard → SQL Editor
-- Times are UTC. Berlin summer (CEST) = UTC+2, winter (CET) = UTC+1.
-- Scheduled for summer time (CEST) as reference. Winter runs 1h early — acceptable.

-- Monday 12:00 → Reminder email
SELECT cron.schedule('sub-reminder-mon','0 10 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
-- Thursday 12:00 → Reminder email
SELECT cron.schedule('sub-reminder-thu','0 10 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Monday 20:00 → Auto-place subscription orders
SELECT cron.schedule('sub-order-mon','0 18 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
-- Thursday 20:00 → Auto-place subscription orders
SELECT cron.schedule('sub-order-thu','0 18 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Monday 22:00 → Lock orders, authorize payment
SELECT cron.schedule('sub-lock-mon','0 20 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
-- Thursday 22:00 → Lock orders, authorize payment
SELECT cron.schedule('sub-lock-thu','0 20 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Every 30 min → Process pending cancellations
SELECT cron.schedule('sub-cancellations','*/30 * * * *',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-cancellations',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);

-- Thursday 22:00 → Switch week cycle (A↔B)
SELECT cron.schedule('week-cycle','0 20 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/week-cycle-switch',headers:='{"Content-Type":"application/json"}'::jsonb) AS request_id;$$
);
