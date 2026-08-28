-- Smittenbrot — Cron authentication (shared secret)
-- Applied 2026-08-28 via the Management API; kept here for the record.
--
-- The subscription-engine is deployed --no-verify-jwt (pg_net crons cannot
-- hold a user JWT), which left its four cron actions callable by ANYONE —
-- including ?action=process-10pm-lock, the Stripe charging loop. The engine
-- now requires `Authorization: Bearer <CRON_SECRET>` (or the service-role
-- key) for every process-* action.
--
-- The secret lives in TWO stores, never in git:
--   1. Edge function env:  npx supabase secrets set CRON_SECRET=<value>
--   2. Postgres Vault:     SELECT vault.create_secret('<value>', 'cron_secret');
--   (the value itself is in .credentials/cron-secret.txt)
-- The jobs read it from Vault AT RUN TIME (subquery below), so rotating the
-- secret = update both stores; no reschedule needed.
--
-- Re-running cron.schedule with an existing job name updates it (upsert).
-- Unchanged: week-cycle — its function (week-cycle-switch) has no secret
-- check yet; harden it the same way as a follow-up.

-- Mon/Thu 12:00 Berlin → Reminder email
SELECT cron.schedule('sub-reminder-mon','0 10,11 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
SELECT cron.schedule('sub-reminder-thu','0 10,11 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-12pm-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);

-- Mon/Thu 20:00 Berlin → Auto-place subscription orders
SELECT cron.schedule('sub-order-mon','0 18,19 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
SELECT cron.schedule('sub-order-thu','0 18,19 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-8pm-order-placement',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);

-- Mon/Thu 22:00 Berlin → Lock orders, charge saved cards
SELECT cron.schedule('sub-lock-mon','0 20,21 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
SELECT cron.schedule('sub-lock-thu','0 20,21 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-10pm-lock',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);

-- Every 30 min → Process pending cancellations (+ auto-resume of pauses)
SELECT cron.schedule('sub-cancellations','*/30 * * * *',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-cancellations',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);

-- Verify:
-- SELECT jobname, schedule FROM cron.job ORDER BY jobname;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
