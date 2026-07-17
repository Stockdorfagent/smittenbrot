-- Add notification preference columns to customers
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS reminder_email BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS reminder_push BOOLEAN NOT NULL DEFAULT true;
