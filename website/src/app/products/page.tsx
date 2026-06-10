'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import Link from 'next/link';

function getNextPickup(): { day: 'wednesday' | 'saturday'; label: string; cutoffLabel: string; fulfillmentDate: string } {
  const now = new Date();
  // Get current time in Europe/Berlin
  const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const day = berlin.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const hours = berlin.getHours();
  const minutes = berlin.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const cutoffMinutes = 22 * 60; // 22:00

  // Helper to get next Wednesday/Saturday date as ISO string
  function nextDayDate(targetDay: number): string {
    const dt = new Date(berlin);
    let diff = (targetDay - dt.getDay() + 7) % 7;
    if (diff === 0) diff += 7;
    dt.setDate(dt.getDate() + diff);
    return dt.toISOString().split('T')[0];
  }

  if (day === 1 && totalMinutes < cutoffMinutes) {
    // Monday before 22:00 → Wednesday this week
    const wed = new Date(berlin);
    wed.setDate(wed.getDate() + 2);
    return {
      day: 'wednesday',
      label: 'Mittwoch',
      cutoffLabel: 'Bestellschluss: heute 22:00',
      fulfillmentDate: wed.toISOString().split('T')[0],
    };
  }

  if ((day === 1 && totalMinutes >= cutoffMinutes) || day === 2 || day === 3) {
    // Monday after 22:00, or Tue/Wed → Saturday this week
    return {
      day: 'saturday',
      label: 'Samstag',
      cutoffLabel: 'Bestellschluss: Donnerstag 22:00',
      fulfillmentDate: nextDayDate(6),
    };
  }

  if (day === 4 && totalMinutes < cutoffMinutes) {
    // Thursday before 22:00 → Saturday this week
    const sat = new Date(berlin);
    sat.setDate(sat.getDate() + 2); // Saturday = Thursday + 2
    return {
      day: 'saturday',
      label: 'Samstag',
      cutoffLabel: 'Bestellschluss: heute 22:00',
      fulfillmentDate: sat.toISOString().split('T')[0],
    };
  }

  // Thursday after 22:00, or Fri/Sat/Sun → next Wednesday
  const wedNext = new Date(berlin);
  let wedDiff = (3 - wedNext.getDay() + 7) % 7;
  if (wedDiff === 0) wedDiff += 7;
  wedNext.setDate(wedNext.getDate() + wedDiff);
  return {
    day: 'wednesday',
    label: 'Mittwoch',
    cutoffLabel: 'Bestellschluss: Montag 22:00',
    fulfillmentDate: wedNext.toISOString().split('T')[0],
  };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [weekCycle, setWeekCycle] = useState<'A' | 'B'>('A');
  const [addingId, setAddingId] = useState<string | null>(null);
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
      }
    }
    fetchProducts();
  }, [pickup.day, weekCycle]);

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
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Sortiment
      </h1>
      <p className="mt-2 text-smitten-text/60">
        Nächste Abholung: <strong>{pickup.label}</strong> ({pickup.cutoffLabel})
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map(product => (
          <div
            key={product.id}
            className="bg-white rounded-xl p-5 border border-smitten-cream"
          >
            <Link href={`/products/${product.id}`}>
              <div className="w-full h-40 bg-smitten-cream rounded-lg flex items-center justify-center overflow-hidden">
                {product.cover_image_url ? (
                  <img
                    src={product.cover_image_url}
                    alt={product.alt_text || product.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-4xl font-display text-smitten-secondary">{product.name.charAt(0)}</span>
                )}
              </div>
            </Link>
            <div className="mt-4">
              <div className="flex items-start justify-between">
                <Link href={`/products/${product.id}`}>
                  <h3 className="font-display text-lg text-smitten-text font-bold hover:underline">
                    {product.name}
                  </h3>
                </Link>
                <span className="text-smitten-accent font-bold">{formatPrice(product.price_cents)}</span>
              </div>
              <p className="mt-1 text-sm text-smitten-text/60 line-clamp-2">
                {product.description}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={() => handleAdd(product)}
                  disabled={addingId === product.id}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    addingId === product.id
                      ? 'bg-green-500 text-white scale-95'
                      : 'bg-smitten-accent text-white hover:bg-smitten-accent/90'
                  }`}
                >
                  {addingId === product.id ? '✓ Hinzugefügt' : 'In den Warenkorb'}
                </button>
              </div>
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <p className="col-span-full text-center text-smitten-text/40 py-10">
            Für diesen Tag sind keine Produkte verfügbar.
          </p>
        )}
      </div>
    </div>
  );
}
