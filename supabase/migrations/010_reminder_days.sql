-- Replace generic reminder_email with day-specific columns
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS reminder_wednesday BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_saturday BOOLEAN NOT NULL DEFAULT true;

-- Migrate existing reminder_email data:
-- Users who had reminder_email=true get both days enabled
UPDATE public.customers 
SET reminder_wednesday = true, reminder_saturday = true 
WHERE reminder_email = true;

-- Keep old column for rollback, will remove later
-- ALTER TABLE public.customers DROP COLUMN reminder_email;
