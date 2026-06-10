-- Tax compliance: Invoice numbers and VAT fields
-- German GoBD-compliant invoice requirements

-- Add sequential invoice number to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS net_total_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_total_cents INTEGER NOT NULL DEFAULT 0;

-- Add tax details to order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_price_gross_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price_net_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC NOT NULL DEFAULT 0.07;

-- Migrate existing data: assume current unit_price_cents is gross (includes 7% VAT)
UPDATE public.order_items SET
  unit_price_gross_cents = unit_price_cents,
  unit_price_net_cents = ROUND(unit_price_cents / 1.07),
  vat_cents = unit_price_cents - ROUND(unit_price_cents / 1.07),
  vat_rate = 0.07
WHERE unit_price_gross_cents = 0;

UPDATE public.orders SET
  net_total_cents = COALESCE((
    SELECT SUM(oi.unit_price_net_cents * oi.quantity)
    FROM public.order_items oi
    WHERE oi.order_id = orders.id
  ), 0),
  vat_total_cents = COALESCE((
    SELECT SUM(oi.vat_cents * oi.quantity)
    FROM public.order_items oi
    WHERE oi.order_id = orders.id
  ), 0)
WHERE net_total_cents = 0;

-- Create sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1;

-- Function to generate invoice number on order lock/fulfillment
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IN ('locked_for_production', 'fulfilled') AND OLD.status NOT IN ('locked_for_production', 'fulfilled') AND NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'RE-' || TO_CHAR(NEW.fulfillment_date, 'YYYY-MM-DD') || '-' || LPAD(nextval('public.invoice_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_invoice_number
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL AND NEW.status IN ('locked_for_production', 'fulfilled'))
  EXECUTE FUNCTION public.assign_invoice_number();

-- Function to auto-calculate net/vat on order_items insert
CREATE OR REPLACE FUNCTION public.calc_order_item_tax()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.unit_price_gross_cents := NEW.unit_price_cents;
  NEW.unit_price_net_cents := ROUND(NEW.unit_price_cents / 1.07);
  NEW.vat_cents := NEW.unit_price_cents - ROUND(NEW.unit_price_cents / 1.07);
  NEW.vat_rate := 0.07;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calc_order_item_tax
  BEFORE INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.calc_order_item_tax();

-- Trigger to update order totals when items change
CREATE OR REPLACE FUNCTION public.update_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.orders SET
    net_total_cents = COALESCE((
      SELECT SUM(oi.unit_price_net_cents * oi.quantity)
      FROM public.order_items oi
      WHERE oi.order_id = COALESCE(NEW.order_id, OLD.order_id)
    ), 0),
    vat_total_cents = COALESCE((
      SELECT SUM(oi.vat_cents * oi.quantity)
      FROM public.order_items oi
      WHERE oi.order_id = COALESCE(NEW.order_id, OLD.order_id)
    ), 0),
    total_cents = COALESCE((
      SELECT SUM(oi.unit_price_gross_cents * oi.quantity)
      FROM public.order_items oi
      WHERE oi.order_id = COALESCE(NEW.order_id, OLD.order_id)
    ), 0)
  WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_update_order_totals
  AFTER INSERT OR DELETE OR UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_order_totals();

-- Add seller info table for invoice headers
CREATE TABLE IF NOT EXISTS public.seller_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Smittenbrot',
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT,
  city TEXT NOT NULL DEFAULT 'Stockdorf',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'Deutschland',
  tax_id TEXT NOT NULL DEFAULT '', -- Steuernummer
  vat_id TEXT, -- Umsatzsteuer-ID if applicable
  email TEXT NOT NULL DEFAULT 'hello@smittenbrot.de',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on seller_info
ALTER TABLE public.seller_info ENABLE ROW LEVEL SECURITY;

-- Only admin can read/write seller_info
CREATE POLICY seller_info_admin_all ON public.seller_info
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Public can read for invoice display
CREATE POLICY seller_info_read_all ON public.seller_info
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Insert default seller info
INSERT INTO public.seller_info (name, address_line1, city, postal_code, email)
VALUES ('Smittenbrot', '', 'Stockdorf', '', 'hello@smittenbrot.de')
ON CONFLICT DO NOTHING;

-- Helper function to get invoice data for an order
CREATE OR REPLACE FUNCTION public.get_order_invoice(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_order JSONB;
  v_seller JSONB;
  v_items JSONB;
BEGIN
  SELECT jsonb_build_object(
    'invoice_number', o.invoice_number,
    'order_date', o.created_at,
    'fulfillment_date', o.fulfillment_date,
    'status', o.status,
    'payment_status', o.payment_status,
    'total_net', o.net_total_cents,
    'total_vat', o.vat_total_cents,
    'total_gross', o.total_cents,
    'customer_name', COALESCE(o.customer_name, c.name),
    'customer_email', COALESCE(o.customer_email, c.email),
    'customer_address', c.address
  )
  INTO v_order
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id;

  SELECT jsonb_build_object(
    'name', name,
    'address_line1', address_line1,
    'address_line2', address_line2,
    'city', city,
    'postal_code', postal_code,
    'country', country,
    'tax_id', tax_id,
    'vat_id', vat_id,
    'email', email
  )
  INTO v_seller
  FROM public.seller_info
  LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price_gross', oi.unit_price_gross_cents,
    'unit_price_net', oi.unit_price_net_cents,
    'vat_cents', oi.vat_cents,
    'vat_rate', oi.vat_rate,
    'line_total_net', oi.unit_price_net_cents * oi.quantity,
    'line_total_gross', oi.unit_price_gross_cents * oi.quantity
  ))
  INTO v_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'seller', v_seller,
    'order', v_order,
    'items', v_items
  );
END;
$$;
