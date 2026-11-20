'use client';

import { CartProvider } from '@/context/CartContext';
import { ClosureProvider } from '@/context/ClosureContext';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ClosureProvider>
      <CartProvider>{children}</CartProvider>
    </ClosureProvider>
  );
}
