import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { CartItem, Cart, PickupDay } from '@/lib/types';

interface CartContextType extends Cart {
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setPickupLocation: (locationId: string) => void;
  setPickupDay: (day: PickupDay) => void;
  setFulfillmentDate: (date: string) => void;
  itemCount: number;
  totalCents: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({
    items: [],
    pickup_location_id: null,
    fulfillment_date: null,
    pickup_day: null,
  });

  const addItem = useCallback((item: CartItem) => {
    setCart((prev) => {
      const existing = prev.items.find((i) => i.product_id === item.product_id);
      if (existing) {
        return {
          ...prev,
          items: prev.items.map((i) =>
            i.product_id === item.product_id
              ? { ...i, quantity: i.quantity + item.quantity }
              : i
          ),
        };
      }
      return { ...prev, items: [...prev.items, item] };
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.product_id !== productId),
    }));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    setCart((prev) => ({
      ...prev,
      items: quantity <= 0
        ? prev.items.filter((i) => i.product_id !== productId)
        : prev.items.map((i) =>
            i.product_id === productId ? { ...i, quantity } : i
          ),
    }));
  }, []);

  const clearCart = useCallback(() => {
    setCart({
      items: [],
      pickup_location_id: null,
      fulfillment_date: null,
      pickup_day: null,
    });
  }, []);

  const setPickupLocation = useCallback((locationId: string) => {
    setCart((prev) => ({ ...prev, pickup_location_id: locationId }));
  }, []);

  const setPickupDay = useCallback((day: PickupDay) => {
    setCart((prev) => ({ ...prev, pickup_day: day }));
  }, []);

  const setFulfillmentDate = useCallback((date: string) => {
    setCart((prev) => ({ ...prev, fulfillment_date: date }));
  }, []);

  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cart.items.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity,
    0
  );

  return (
    <CartContext.Provider
      value={{
        ...cart,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        setPickupLocation,
        setPickupDay,
        setFulfillmentDate,
        itemCount,
        totalCents,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
