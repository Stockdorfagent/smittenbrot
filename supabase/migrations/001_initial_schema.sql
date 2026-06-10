-- Smittenbrot - Initial Schema Migration
-- Creates all tables, indexes, RLS policies, and seed data

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════
-- Helper: is_admin check
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT is_admin FROM public.customers WHERE id = auth.uid()),
    false
  );
END;
$$;

-- ═══════════════════════════════════════════════
-- TABLE: pickup_locations
-- ═══════════════════════════════════════════════
CREATE TABLE public.pickup_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  active BOOLEAN DEFAULT true NOT NULL,
  notification_template TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: customers
-- ═══════════════════════════════════════════════
CREATE TABLE public.customers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  preferred_pickup_location_id UUID REFERENCES public.pickup_locations(id) ON DELETE SET NULL,
  push_token TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: products
-- ═══════════════════════════════════════════════
CREATE TABLE public.products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  tax_rate NUMERIC NOT NULL DEFAULT 0.07,
  capacity INTEGER NOT NULL,
  cycle TEXT NOT NULL CHECK (cycle IN ('permanent', 'week_a', 'week_b', 'hidden')),
  available_wed BOOLEAN NOT NULL DEFAULT true,
  available_sat BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  cover_image_url TEXT,
  images TEXT[] DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: week_cycle
-- ═══════════════════════════════════════════════
CREATE TABLE public.week_cycle (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  current_week TEXT NOT NULL CHECK (current_week IN ('A', 'B')),
  switched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: subscriptions
-- ═══════════════════════════════════════════════
CREATE TABLE public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancellation_pending', 'cancelled', 'payment_failed')),
  paused_until DATE,
  pickup_location_id UUID NOT NULL REFERENCES public.pickup_locations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: subscription_items
-- ═══════════════════════════════════════════════
CREATE TABLE public.subscription_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: orders
-- ═══════════════════════════════════════════════
CREATE TABLE public.orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('one_time', 'subscription')),
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  fulfillment_date DATE NOT NULL,
  pickup_location_id UUID NOT NULL REFERENCES public.pickup_locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'grace_period_open', 'locked_for_production', 'fulfilled', 'refunded', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  stripe_payment_intent_id TEXT,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  notes TEXT,
  customer_email TEXT,
  customer_name TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: order_items
-- ═══════════════════════════════════════════════
CREATE TABLE public.order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- TABLE: closures
-- ═══════════════════════════════════════════════
CREATE TABLE public.closures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  banner_text_de TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT closures_date_check CHECK (end_date >= start_date)
);

-- ═══════════════════════════════════════════════
-- TABLE: notifications
-- ═══════════════════════════════════════════════
CREATE TABLE public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('subscription_reminder', 'order_placed', 'pickup_ready', 'payment_failed', 'admin_alert', 'closure_notice', 'subscription_paused', 'subscription_cancelled')),
  channel TEXT NOT NULL CHECK (channel IN ('push', 'email', 'both')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered BOOLEAN NOT NULL DEFAULT false,
  error TEXT
);

-- ═══════════════════════════════════════════════
-- TABLE: audit_log
-- ═══════════════════════════════════════════════
CREATE TABLE public.audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  old_data JSONB,
  new_data JSONB,
  performed_by UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════
CREATE INDEX idx_orders_fulfillment_status ON public.orders(fulfillment_date, status);
CREATE INDEX idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX idx_subscriptions_customer_status ON public.subscriptions(customer_id, status);
CREATE INDEX idx_subscription_items_subscription ON public.subscription_items(subscription_id);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_products_active ON public.products(active);
CREATE INDEX idx_closures_dates ON public.closures(start_date, end_date);
CREATE INDEX idx_orders_idempotency_key ON public.orders(idempotency_key);
CREATE INDEX idx_notifications_customer ON public.notifications(customer_id);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_customers_email ON public.customers(email);

-- ═══════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ── customers ──
CREATE POLICY customers_self ON public.customers
  FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY customers_admin_all ON public.customers
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── pickup_locations (public read) ──
CREATE POLICY pickup_locations_read_all ON public.pickup_locations
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY pickup_locations_admin_all ON public.pickup_locations
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── products (public read) ──
CREATE POLICY products_read_all ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY products_admin_all ON public.products
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── week_cycle ──
CREATE POLICY week_cycle_read_all ON public.week_cycle
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY week_cycle_admin_all ON public.week_cycle
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── subscriptions ──
CREATE POLICY subscriptions_self ON public.subscriptions
  FOR ALL
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY subscriptions_admin_all ON public.subscriptions
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── subscription_items ──
CREATE POLICY subscription_items_self ON public.subscription_items
  FOR ALL
  TO authenticated
  USING (
    subscription_id IN (
      SELECT id FROM public.subscriptions WHERE customer_id = auth.uid()
    )
  )
  WITH CHECK (
    subscription_id IN (
      SELECT id FROM public.subscriptions WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY subscription_items_admin_all ON public.subscription_items
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── orders ──
CREATE POLICY orders_self ON public.orders
  FOR ALL
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY orders_admin_all ON public.orders
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── order_items ──
CREATE POLICY order_items_self ON public.order_items
  FOR ALL
  TO authenticated
  USING (
    order_id IN (
      SELECT id FROM public.orders WHERE customer_id = auth.uid()
    )
  )
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY order_items_admin_all ON public.order_items
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── closures ──
CREATE POLICY closures_read_all ON public.closures
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY closures_admin_all ON public.closures
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── notifications ──
CREATE POLICY notifications_self ON public.notifications
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY notifications_admin_all ON public.notifications
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── audit_log ──
CREATE POLICY audit_log_admin_all ON public.audit_log
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════

-- Pickup locations
INSERT INTO public.pickup_locations (id, name, address, active, sort_order, notification_template)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'Stockdorf',
    'Stockdorf, Bayern',
    true,
    1,
    'Deine Bestellung {ORDER_NUMBER} ist abholbereit in {PICKUP_LOCATION}. Abholcode: {CODE}'
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    'Feichtstr.',
    'Feichtstraße, München',
    true,
    2,
    'Deine Bestellung {ORDER_NUMBER} ist abholbereit in {PICKUP_LOCATION}. Abholcode: {CODE}'
  );

-- Products (capacities as specified in BUILD_PROMPT)
INSERT INTO public.products (id, name, description, price_cents, capacity, cycle, available_wed, available_sat, sort_order) VALUES
  -- Permanent products (available every week)
  (
    'b1000000-0000-0000-0000-000000000001',
    'Stockdorf Sourdough',
    'Stockdorf Sourdough ist das lokale Pendant zum klassischen San Francisco Sourdough: schlicht, ehrlich und mit viel Geduld hergestellt. Gebacken aus nur Weizenmehl, Wasser und Salz und mit einer langen Fermentation von rund 20 Stunden entwickelt dieses Brot ein ausgewogenes, mild-säuerliches Aroma. Eine kräftige Kruste und eine lockere, saftige Krume machen es zu einem vielseitigen Alltagsbrot.

Gewicht: ca. 750g
Zutaten: Weizenmehl 1050, Wasser, Meersalz, Acerolakirschpulver
Allergene: Weizen
In der gleichen Backstube werden oft auch Eier, Erdnüsse, Milch, Schalenfrüchte, Sellerie, Senf, Sesam und Soja verarbeitet. Spuren dieser Allergene können daher nicht ausgeschlossen werden.',
    695,
    12,
    'permanent',
    true,
    true,
    1
  ),
  (
    'b1000000-0000-0000-0000-000000000002',
    'Wheat & Rye Sourdough',
    'Saftiges Mischbrot aus Weizen- und Roggensauerteig. Herzhaft und aromatisch.',
    850,
    15,
    'permanent',
    true,
    true,
    2
  ),
  (
    'b1000000-0000-0000-0000-000000000003',
    'Brioche',
    'Buttrig-weiches Briochebrot. Ideal für süße und herzhafte Aufstriche.',
    600,
    12,
    'permanent',
    true,
    true,
    3
  ),
  (
    'b1000000-0000-0000-0000-000000000004',
    'Focaccia',
    'Italienisches Olivenöl-Fladenbrot mit Meersalz und Rosmarin.',
    500,
    12,
    'permanent',
    true,
    true,
    4
  ),
  (
    'b1000000-0000-0000-0000-000000000005',
    'Kokos cookies',
    'Knusprige Kokosmakronen – glutenfrei und unwiderstehlich.',
    350,
    25,
    'permanent',
    true,
    true,
    5
  ),
  (
    'b1000000-0000-0000-0000-000000000006',
    'Mandel cookies',
    'Feine Mandelkekse mit knackiger Textur. Ideal zum Kaffee.',
    350,
    25,
    'permanent',
    true,
    true,
    6
  ),

  -- Week A products
  (
    'b1000000-0000-0000-0000-000000000007',
    'Ciabatta',
    'Luftiges italienisches Weißbrot mit knuspriger Kruste.',
    450,
    12,
    'week_a',
    true,
    true,
    7
  ),
  (
    'b1000000-0000-0000-0000-000000000008',
    'Vollkorn Sourdough',
    'Vollkorn-Sauerteigbrot mit nussigem Geschmack und hohem Ballaststoffgehalt.',
    900,
    10,
    'week_a',
    true,
    true,
    8
  ),

  -- Week B products
  (
    'b1000000-0000-0000-0000-000000000009',
    'Dinkel Sourdough',
    'Mildes Dinkel-Sauerteigbrot. Bekömmlich und aromatisch.',
    900,
    10,
    'week_b',
    true,
    true,
    9
  ),
  (
    'b1000000-0000-0000-0000-000000000010',
    'Baguette',
    'Französisches Baguette mit goldener Kruste und weichem Kern.',
    400,
    12,
    'week_b',
    true,
    true,
    10
  );

-- Week cycle starts at A
INSERT INTO public.week_cycle (id, current_week, switched_at)
VALUES (
  'c1000000-0000-0000-0000-000000000001',
  'A',
  now()
);
