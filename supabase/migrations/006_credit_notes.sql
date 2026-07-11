-- Credit Notes / Storno-Rechnungen (German GoBD-compliant)
-- Generated when an invoiced order is cancelled

-- Sequence for credit note numbers
CREATE SEQUENCE IF NOT EXISTS public.credit_note_seq START 1;

-- Credit notes table
CREATE TABLE IF NOT EXISTS public.credit_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  credit_note_number TEXT NOT NULL UNIQUE,
  original_invoice_number TEXT NOT NULL,
  total_gross_cents INTEGER NOT NULL,
  total_net_cents INTEGER NOT NULL,
  total_vat_cents INTEGER NOT NULL,
  vat_rate NUMERIC NOT NULL DEFAULT 0.07,
  reason TEXT NOT NULL DEFAULT 'Stornierung',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

-- Admin can read all
CREATE POLICY credit_notes_admin_all ON public.credit_notes
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Customer can read their own
CREATE POLICY credit_notes_customer_read ON public.credit_notes
  FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders WHERE customer_id = auth.uid()
    )
  );

-- Function to auto-generate credit note number
CREATE OR REPLACE FUNCTION public.assign_credit_note_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.credit_note_number := 'ST-' || TO_CHAR(NOW(), 'YYYY-MM-DD') || '-' || LPAD(nextval('public.credit_note_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_credit_note_number
  BEFORE INSERT ON public.credit_notes
  FOR EACH ROW
  WHEN (NEW.credit_note_number IS NULL)
  EXECUTE FUNCTION public.assign_credit_note_number();
