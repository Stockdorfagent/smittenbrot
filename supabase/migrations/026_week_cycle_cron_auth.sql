-- week-cycle-switch toggle now requires the cron secret (or an is_admin JWT).
-- Same pattern as migration 024: the job reads the secret from Vault at run
-- time. Schedule unchanged — deliberately single-fired (dual-scheduling the
-- unguarded A/B flip would toggle twice = no switch, see migration 015).
SELECT cron.schedule('week-cycle','0 20 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/week-cycle-switch',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
