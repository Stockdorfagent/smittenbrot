-- Add pause_start column for subscription pause date ranges
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS paused_from DATE;
