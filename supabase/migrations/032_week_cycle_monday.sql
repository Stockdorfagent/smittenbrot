-- 032: the A/B week now flips on MONDAY 22:00 Berlin (the Wednesday cutoff), not Thursday (owner, 24.09.2026).
--
-- Why: a cycle week is a Saturday + the Wednesday after it. Wednesday-only pickup locations (AB90, Feichtstr.)
-- ordered on Tue–Thu get "next Wednesday" (website 0daeda9); with the old Thursday flip that Wednesday was
-- always the OTHER cycle, so a basket could be "nicht im Sortiment". Pairing Sat→Wed removes that.
-- Consequence agreed with the owner: Sat 26.09. (A) and Wed 30.09. are both A; B starts Sat 03.10. + Wed 07.10.
--
-- Dual UTC hour (20 = summer, 21 = winter); week-cycle-switch drops the firing that is not 22:00 Berlin.
-- Re-running cron.schedule with an existing jobname replaces the schedule (upsert) — the Thursday firing is gone.
SELECT cron.schedule('week-cycle','0 20,21 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/week-cycle-switch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
