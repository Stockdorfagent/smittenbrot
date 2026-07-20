-- Add pickup_day column to subscriptions
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS pickup_day TEXT NOT NULL DEFAULT 'wednesday' CHECK (pickup_day IN ('wednesday', 'saturday'));
