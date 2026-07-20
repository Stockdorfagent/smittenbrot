// ============================================================
// Smittenbrot Types (mobile-owned; formerly re-exported from the
// shared workspace package, inlined after the app was decoupled)
// ============================================================

// --- Customers ---
export interface Customer {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  preferred_pickup_location_id: string | null;
  push_token: string | null;
  created_at: string;
  updated_at: string;
}

// --- Pickup Locations ---
export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  active: boolean;
  notification_template: string;
  sort_order: number;
  created_at: string;
}

// --- Products ---
export type ProductCycle = 'permanent' | 'week_a' | 'week_b' | 'hidden';
export type ProductStatus = 'active' | 'hidden';

export interface Product {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  tax_rate: number;
  capacity: number;
  cycle: ProductCycle;
  available_wed: boolean;
  available_sat: boolean;
  active: boolean;
  cover_image_url: string | null;
  images: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// --- Week Cycle ---
export type WeekType = 'A' | 'B';

export interface WeekCycle {
  id: string;
  current_week: WeekType;
  switched_at: string;
  created_at: string;
}

// --- Subscriptions ---
export type SubscriptionStatus =
  | 'active'
  | 'paused'
  | 'cancellation_pending'
  | 'cancelled'
  | 'payment_failed';

export interface Subscription {
  id: string;
  customer_id: string;
  status: SubscriptionStatus;
  paused_until: string | null;
  pickup_day: PickupDay;
  pickup_location_id: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionItem {
  id: string;
  subscription_id: string;
  product_id: string;
  quantity: number;
}

// --- Orders ---
export type OrderType = 'one_time' | 'subscription';
export type OrderStatus =
  | 'scheduled'
  | 'processing'
  | 'grace_period_open'
  | 'locked_for_production'
  | 'fulfilled'
  | 'refunded'
  | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Order {
  id: string;
  customer_id: string | null;
  order_type: OrderType;
  subscription_id: string | null;
  fulfillment_date: string;
  pickup_location_id: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  total_cents: number;
  notes: string | null;
  customer_email: string | null;
  customer_name: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

export interface OrderWithItems extends Order {
  items: (OrderItem & { product: Product })[];
  pickup_location: PickupLocation;
}

// --- Closures ---
export interface Closure {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  banner_text_de: string;
  created_at: string;
}

// --- Notifications ---
export type NotificationType =
  | 'subscription_reminder'
  | 'order_placed'
  | 'pickup_ready'
  | 'payment_failed'
  | 'admin_alert'
  | 'closure_notice'
  | 'subscription_paused'
  | 'subscription_cancelled';

export type NotificationChannel = 'push' | 'email' | 'both';

export interface Notification {
  id: string;
  customer_id: string | null;
  type: NotificationType;
  channel: NotificationChannel;
  sent_at: string;
  delivered: boolean;
  error: string | null;
}

// --- Audit Log ---
export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  performed_by: string;
  created_at: string;
}

// --- API Responses ---
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface CapacityInfo {
  product_id: string;
  product_name: string;
  max_capacity: number;
  reserved_count: number;
  available_count: number;
}

export interface ProductionSheetItem {
  product_id: string;
  product_name: string;
  total_quantity: number;
  capacity: number;
}

export interface ProductionSheet {
  production_date: string;
  pickup_date: string;
  items: ProductionSheetItem[];
}

// ============================================================
// App-specific types
// ============================================================

export type PickupDay = 'wednesday' | 'saturday';

export interface CartItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Cart {
  items: CartItem[];
  pickup_location_id: string | null;
  fulfillment_date: string | null;
  pickup_day: PickupDay | null;
}

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
  } | null;
  loading: boolean;
}
