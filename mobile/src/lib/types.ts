export * from '../../shared/src/index';

// App-specific types
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
