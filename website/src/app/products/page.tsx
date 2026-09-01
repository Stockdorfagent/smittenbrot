'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import { getNextPickup } from '@/lib/pickup';
import { fetchSoldOut } from '@/lib/soldOut';
import Link from 'next/link';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [weekCycle, setWeekCycle] = useState<'A' | 'B'>('A');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({});
  const { addItem } = useCart();

  const pickup = getNextPickup();

  useEffect(() => {
    async function fetchData() {
      const { data: cycleData } = await supabase
        .from('week_cycle')
        .select('current_week')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (cycleData) setWeekCycle(cycleData.current_week);
    }
    fetchData();
  }, []);

  useEffect(() => {
    async function fetchProducts() {
      let query = supabase
        .from('products')
        .select('*')
        .eq('active', true);

      if (pickup.day === 'wednesday') {
        query = query.eq('available_wed', true);
      } else {
        query = query.eq('available_sat', true);
      }

      const { data } = await query.order('sort_order', { ascending: true });
      if (data) {
        const filtered = data.filter(p => {
          if (p.cycle === 'permanent') return true;
          if (p.cycle === 'week_a') return weekCycle === 'A';
          if (p.cycle === 'week_b') return weekCycle === 'B';
          return false;
        });
        setProducts(filtered);
        // Real availability per product (same source as the app's badge);
        // arrives a beat later, the cards render available in the meantime.
        setSoldOut(await fetchSoldOut(filtered.map((p) => p.id), pickup.date));
      }
    }
    fetchProducts();
  }, [pickup.day, pickup.date, weekCycle]);

  const handleAdd = (product: Product) => {
    addItem({
      productId: product.id,
      name: product.name,
      priceCents: product.price_cents,
      quantity: 1,
    });
    setAddingId(product.id);
    setTimeout(() => setAddingId(null), 800);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-smitten-text">
        Sortiment
      </h1>
      <p className="mt-2 text-sm text-smitten-secondary">
        Jetzt bestellen für <strong className="text-smitten-text font-semibold">{pickup.label}</strong> · {pickup.cutoffLabel}
      </p>
      <p className="mt-1 text-xs text-smitten-secondary/70">Alle Preise inkl. 7 % MwSt.</p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {products.map(product => (
          <div
            key={product.id}
            className="group flex flex-col bg-white rounded-2xl overflow-hidden border border-smitten-cream hover:border-smitten-text/15 hover:shadow-md transition-all"
          >
            <Link href={`/products/${product.id}`}>
              <div className="aspect-[4/3] bg-smitten-cream overflow-hidden">
                {product.cover_image_url ? (
                  <img
                    src={product.cover_image_url}
                    alt={product.alt_text || product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-smitten-secondary/50">{product.name.charAt(0)}</div>
                )}
              </div>
            </Link>
            <div className="flex flex-col flex-1 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/products/${product.id}`}>
                  <h3 className="font-bold text-smitten-text hover:underline">
                    {product.name}
                  </h3>
                </Link>
                <span className="shrink-0 font-semibold text-smitten-text">{formatPrice(product.price_cents)}</span>
              </div>
              <p className="mt-1 text-sm text-smitten-text line-clamp-2">
                {product.description}
              </p>
              {soldOut[product.id] ? (
                <div className="mt-4 w-full px-4 py-2.5 rounded-full text-sm font-semibold text-center bg-smitten-cream text-smitten-secondary">
                  Ausverkauft
                </div>
              ) : (
                <button
                  onClick={() => handleAdd(product)}
                  disabled={addingId === product.id}
                  className={`mt-4 w-full px-4 py-2.5 rounded-full text-sm font-semibold transition-all ${
                    addingId === product.id
                      ? 'bg-smitten-text text-white scale-[0.98]'
                      : 'bg-smitten-accent text-white hover:bg-smitten-accent/90'
                  }`}
                >
                  {addingId === product.id ? '✓ Hinzugefügt' : 'In den Warenkorb'}
                </button>
              )}
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <p className="col-span-full text-center text-smitten-secondary py-10">
            Für diesen Tag sind keine Produkte verfügbar.
          </p>
        )}
      </div>
    </div>
  );
}
