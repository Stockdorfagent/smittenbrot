-- Discount codes table
CREATE TABLE IF NOT EXISTS public.discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')) DEFAULT 'percentage',
  value INTEGER NOT NULL, -- percentage (e.g. 50 = 50%) or fixed cents (e.g. 200 = €2,00)
  max_uses INTEGER, -- null = unlimited
  max_uses_per_customer INTEGER DEFAULT 1,
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Track usage per customer
CREATE TABLE IF NOT EXISTS public.discount_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id UUID NOT NULL REFERENCES public.discounts(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  email TEXT,
  used_at TIMESTAMPTZ DEFAULT now()
);

-- Add discount reference to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_id UUID REFERENCES public.discounts(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_code TEXT;

-- Add discount columns to invoice number sequence (already exists)

-- RLS
ALTER TABLE public.discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_usage ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "admin_all_discounts" ON public.discounts
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.customers WHERE is_admin = true))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.customers WHERE is_admin = true));

-- Anyone can read active discounts (needed for validation)
CREATE POLICY "read_active_discounts" ON public.discounts
  FOR SELECT USING (active = true);

-- Admin can do everything on usage
CREATE POLICY "admin_all_usage" ON public.discount_usage
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.customers WHERE is_admin = true))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.customers WHERE is_admin = true));

-- Anyone can insert usage (needed during checkout)
CREATE POLICY "insert_usage" ON public.discount_usage
  FOR INSERT WITH CHECK (true);

-- Seed the WILKOMMEN26 discount
INSERT INTO public.discounts (code, description, type, value, max_uses, max_uses_per_customer, active)
VALUES ('WILKOMMEN26', '50% Rabatt auf die erste Bestellung', 'percentage', 50, NULL, 1, true)
ON CONFLICT (code) DO NOTHING;
