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
  active: boolean;
  cover_image_url: string | null;
  alt_text: string | null;
  images: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  active: boolean;
  notification_template: string;
  sort_order: number;
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
  stripe_payment_intent_id: string | null;
  total_cents: number;
  notes: string | null;
  customer_email: string | null;
  customer_name: string | null;
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
  pickup_location_id: string;
  created_at: string;
}

export interface SubscriptionItem {
  id: string;
  subscription_id: string;
  product_id: string;
  quantity: number;
}

export function formatPrice(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace('.', ',')}`;
}
