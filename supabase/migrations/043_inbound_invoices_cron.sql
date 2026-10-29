-- 043: poll belege@smittenbrot.de for forwarded supplier invoices (production step 5, phase 3; owner 30.10.2026).
-- Every 5 minutes pg_cron calls the website route, authenticated with the vault's cron_secret
-- (same as the subscription crons, migration 024). The route reads the IONOS mailbox over IMAP
-- and turns new mails from the owner's addresses into draft deliveries.
select cron.unschedule('inbound-invoices') where exists (select 1 from cron.job where jobname = 'inbound-invoices');
select cron.schedule('inbound-invoices', '*/5 * * * *',
  $$SELECT net.http_post(
      url:='https://smittenbrot.de/api/cron/inbound-invoices',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
      body:='{}'::jsonb,
      timeout_milliseconds:=240000) AS request_id;$$);
