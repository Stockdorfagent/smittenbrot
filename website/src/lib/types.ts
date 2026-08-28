export interface Product {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  tax_rate: number;
  capacity: number;
  cycle: 'permanent' | 'week_a' | 'week_b' | 'hidden';
  available_wed: boolean;
  available_sat: boolean;
  subscribable: boolean;
  active: boolean;
  cover_image_url: string | null;
  alt_text: string | null;
  images: string[];
  sort_order: number;
  created_at: string;
}

export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  active: boolean;
  cabinet_code: string | null;
  notification_template: string;
  pickup_instructions: string | null;
  sort_order: number;
  /** Which pickup days this location serves (migration 018). Only Waldstr.
   *  has Saturday today; the flags decide, so no location name is hardcoded. */
  available_wed: boolean;
  available_sat: boolean;
}

export interface Order {
  id: string;
  customer_id: string | null;
  order_type: 'one_time' | 'subscription';
  subscription_id: string | null;
  fulfillment_date: string;
  pickup_location_id: string;
  status: 'scheduled' | 'processing' | 'grace_period_open' | 'locked_for_production' | 'fulfilled' | 'refunded' | 'cancelled';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  /** Set when the "abholbereit" notice was sent; null until then. */
  pickup_ready_at: string | null;
  stripe_payment_intent_id: string | null;
  total_cents: number;
  notes: string | null;
  customer_email: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  order_number: string | null;
  discount_code: string | null;
  discount_cents: number | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Subscription {
  id: string;
  customer_id: string;
  status: 'active' | 'paused' | 'cancellation_pending' | 'cancelled' | 'payment_failed';
  paused_until: string | null;
  pickup_day: 'wednesday' | 'saturday' | 'both' | null;
  pickup_location_id: string;
  created_at: string;
}

export interface SubscriptionItem {
  id: string;
  subscription_id: string;
  product_id: string;
  quantity: number;
}

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  preferred_pickup_location_id: string | null;
  push_token: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

/** Money, German-style: 4,00 € — comma decimal, symbol after the amount. */
export function formatPrice(cents: number): string {
  return `${((cents ?? 0) / 100).toFixed(2).replace('.', ',')} €`;
}
