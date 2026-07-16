-- Test invoice mode: toggle between production and test numbering
-- Production: RE-00124, #00124, ST-YYYY-MM-DD-XXXXX
-- Test:      TEST-RE-00001, TEST-#00001, TEST-ST-YYYY-MM-DD-XXXXX

-- System settings table (singleton row)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id BIGINT PRIMARY KEY DEFAULT 1,
  invoice_mode TEXT NOT NULL DEFAULT 'production' CHECK (invoice_mode IN ('production', 'test')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Test sequence starting at 1
CREATE SEQUENCE IF NOT EXISTS public.test_order_number_seq START 1;

-- Test credit note sequence
CREATE SEQUENCE IF NOT EXISTS public.test_credit_note_seq START 1;

-- Insert default row if not exists
INSERT INTO public.system_settings (id, invoice_mode)
VALUES (1, 'production')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated read
CREATE POLICY "allow_read_system_settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

-- Allow admin write (sophia@smittenbrot.de)
CREATE POLICY "allow_admin_write_system_settings"
  ON public.system_settings FOR UPDATE
  TO authenticated
  USING (auth.jwt() ->> 'email' = 'sophia@smittenbrot.de')
  WITH CHECK (auth.jwt() ->> 'email' = 'sophia@smittenbrot.de');

-- Updated order number assigner: respects invoice_mode
CREATE OR REPLACE FUNCTION public.assign_order_numbers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num INTEGER;
  mode TEXT;
BEGIN
  IF NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid') AND NEW.invoice_number IS NULL THEN
    -- Read current invoice mode
    SELECT invoice_mode INTO mode FROM public.system_settings WHERE id = 1;
    IF mode IS NULL THEN mode := 'production'; END IF;

    IF mode = 'test' THEN
      next_num := nextval('public.test_order_number_seq');
      NEW.order_number := 'TEST-#' || LPAD(next_num::TEXT, 5, '0');
      NEW.invoice_number := 'TEST-RE-' || LPAD(next_num::TEXT, 5, '0');
    ELSE
      next_num := nextval('public.order_number_seq');
      NEW.order_number := '#' || LPAD(next_num::TEXT, 5, '0');
      NEW.invoice_number := 'RE-' || LPAD(next_num::TEXT, 5, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Updated credit note assigner: respects invoice_mode
CREATE OR REPLACE FUNCTION public.assign_credit_note_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mode TEXT;
BEGIN
  SELECT invoice_mode INTO mode FROM public.system_settings WHERE id = 1;
  IF mode IS NULL THEN mode := 'production'; END IF;

  IF mode = 'test' THEN
    NEW.credit_note_number := 'TEST-ST-' || TO_CHAR(NOW(), 'YYYY-MM-DD') || '-' || LPAD(nextval('public.test_credit_note_seq')::TEXT, 5, '0');
  ELSE
    NEW.credit_note_number := 'ST-' || TO_CHAR(NOW(), 'YYYY-MM-DD') || '-' || LPAD(nextval('public.credit_note_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
