-- Order numbering: assign order_number + invoice_number at payment, not at fulfillment
-- Continues from Squarespace (#00123 was last order)

-- Add order_number column if not already present (was added manually to Supabase)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number TEXT;

-- Create sequence starting at 124 (Squarespace had 123 orders)
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 124;

-- Remove old trigger that assigned invoice_number on locked_for_production/fulfilled
DROP TRIGGER IF EXISTS trg_assign_invoice_number ON public.orders;
DROP FUNCTION IF EXISTS public.assign_invoice_number();

-- New trigger: assign order_number + invoice_number when payment succeeds
CREATE OR REPLACE FUNCTION public.assign_order_numbers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid') AND NEW.invoice_number IS NULL THEN
    next_num := nextval('public.order_number_seq');
    NEW.order_number := '#' || LPAD(next_num::TEXT, 5, '0');
    NEW.invoice_number := 'RE-' || LPAD(next_num::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_order_numbers
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.assign_order_numbers();
