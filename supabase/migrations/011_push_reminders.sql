-- Add push notification preference columns to customers
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS push_wednesday BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS push_saturday BOOLEAN NOT NULL DEFAULT true;
