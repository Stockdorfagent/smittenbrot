-- Fix get_order_invoice: it selected c.address, a column `customers` never
-- had (the shop is pickup-only, no customer addresses anywhere). Every call
-- failed with "column c.address does not exist" — which went unnoticed
-- because real receipts are sent inline by the engine/webhook; only the
-- notification-dispatch `send-order-receipt` (re)send path uses this RPC.
-- Found 2026-08-29 while sending per-Abholort test receipts.
-- `customer_address` stays in the payload as NULL so the JSON shape is
-- unchanged for any consumer.
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
    'customer_address', NULL
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
