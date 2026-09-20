-- 030: Bestell-Erinnerung per E-Mail for customers WITHOUT a Dauerbestellung (owner, 20.09.2026).
--
-- The app reminds with local push notifications (mobile/src/lib/reminder.ts); this is the
-- website-only counterpart: an e-mail at 12:00 Berlin on the order day (Monday for the
-- Wednesday pickup, Thursday for the Saturday pickup), opt-in per day in /profile.
--
-- 1. Re-purpose the never-wired columns from migration 010 as OPT-IN flags. 010 backfilled
--    them to true for everyone (reminder_saturday even defaults to true), which would mail
--    all 90 customers on Thursday. Reset to false; the customer switches them on in Profil.
alter table public.customers alter column reminder_wednesday set default false;
alter table public.customers alter column reminder_saturday  set default false;
update public.customers set reminder_wednesday = false, reminder_saturday = false
 where reminder_wednesday or reminder_saturday;
comment on column public.customers.reminder_wednesday is
  'Opt-in: e-mail Bestell-Erinnerung Monday 12:00 Berlin for the Wednesday pickup (customers without an Abo for that day). Website /profile.';
comment on column public.customers.reminder_saturday is
  'Opt-in: e-mail Bestell-Erinnerung Thursday 12:00 Berlin for the Saturday pickup (customers without an Abo for that day). Website /profile.';

-- 2. New notification type for the log (the CHECK would otherwise reject the insert silently).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type = any (array[
    'subscription_reminder', 'order_placed', 'order_receipt', 'pickup_ready', 'payment_failed',
    'admin_alert', 'closure_notice', 'subscription_paused', 'subscription_cancelled',
    'order_reminder'
  ])
);

-- 3. Cron: Mon/Thu 12:00 Berlin (dual UTC hour, the engine's DST guard drops the wrong one),
--    same Vault-secret auth as migration 024.
select cron.schedule('order-reminder-mon','0 10,11 * * 1',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-order-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
select cron.schedule('order-reminder-thu','0 10,11 * * 4',
  $$SELECT net.http_post(url:='https://aoryokgzmpezanmlgxtl.functions.supabase.co/subscription-engine?action=process-order-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'))) AS request_id;$$
);
