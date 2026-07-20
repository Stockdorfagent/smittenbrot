'use client';

import { useEffect, useState } from 'react';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { PickupLocation, formatPrice } from '@/lib/types';
import { getNextPickup } from '@/lib/pickup';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CartPage() {
  const { state, removeItem, updateQuantity, clearCart, setPickupLocation, totalCents, itemCount } = useCart();
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [isGuest, setIsGuest] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const router = useRouter();
  const pickup = getNextPickup();

  useEffect(() => {
    async function init() {
      // Fetch locations
      const { data } = await supabase
        .from('pickup_locations')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      
      if (data && data.length > 0) {
        setLocations(data);
        
        // Check if logged in and pre-fill preferred location
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setIsGuest(false);
          const { data: customer } = await supabase
            .from('customers')
            .select('id, preferred_pickup_location_id, name, email')
            .eq('id', session.user.id)
            .single();
          if (customer) {
            if (customer.name) setGuestName(customer.name);
            if (customer.email) setGuestEmail(customer.email);
            // Always prefer the profile's preferred pickup location
            setPickupLocation(customer.preferred_pickup_location_id || data[0].id);
          }
        } else if (!state.pickupLocationId) {
          setPickupLocation(data[0].id);
        }
      }
    }
    init();
  }, []);

  const handleCheckout = () => {
    if (isGuest && (!guestName || !guestEmail)) return;
    const params = new URLSearchParams();
    if (isGuest) {
      params.set('name', guestName);
      params.set('email', guestEmail);
    }
    router.push(`/checkout?${params.toString()}`);
  };

  if (state.items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Warenkorb</h1>
        <p className="mt-4 text-smitten-text">Dein Warenkorb ist leer.</p>
        <Link
          href="/products"
          className="mt-6 inline-block bg-smitten-primary text-white px-6 py-2 rounded-full text-sm"
        >
          Zum Sortiment
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">
          Warenkorb ({itemCount} Artikel)
        </h1>
        <button
          onClick={clearCart}
          className="text-sm text-red-500 hover:underline"
        >
          Leeren
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {state.items.map(item => (
          <div
            key={item.productId}
            className="flex items-center gap-4 bg-white rounded-xl p-4 border border-smitten-cream"
          >
            <div className="w-16 h-16 bg-smitten-cream rounded-lg flex items-center justify-center text-xl font-display text-smitten-secondary shrink-0">
              {item.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-smitten-text truncate">{item.name}</p>
              <p className="text-sm text-smitten-accent font-medium">
                {formatPrice(item.priceCents)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                className="w-8 h-8 rounded-full border border-smitten-cream flex items-center justify-center text-sm hover:bg-smitten-cream"
              >
                −
              </button>
              <span className="w-6 text-center text-sm">{item.quantity}</span>
              <button
                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                className="w-8 h-8 rounded-full border border-smitten-cream flex items-center justify-center text-sm hover:bg-smitten-cream"
              >
                +
              </button>
            </div>
            <p className="w-20 text-right font-medium text-smitten-text">
              {formatPrice(item.priceCents * item.quantity)}
            </p>
            <button
              onClick={() => removeItem(item.productId)}
              className="text-smitten-text/30 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <label className="block text-sm font-medium text-smitten-text">Abholung</label>
        <p className="mt-1 text-sm text-smitten-secondary">
          <strong className="text-smitten-text font-semibold">{pickup.label}</strong> · {pickup.cutoffLabel}
        </p>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-smitten-text">Abholort</label>
        <select
          value={state.pickupLocationId || ''}
          onChange={e => setPickupLocation(e.target.value)}
          className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
        >
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>

      {isGuest && (
      <div className="mt-6 p-4 bg-smitten-cream rounded-xl">
        <p className="text-sm text-smitten-text">
          Mit einem Konto bestellst du schneller und kannst Abos verwalten.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => { setIsGuest(false); router.push('/login'); }}
            className="px-4 py-1.5 rounded-full text-sm border border-smitten-primary text-smitten-text hover:bg-smitten-cream"
          >
            Anmelden
          </button>
          <button
            onClick={() => setIsGuest(true)}
            className={`px-4 py-1.5 rounded-full text-sm ${isGuest ? 'bg-smitten-primary text-white' : 'bg-white text-smitten-text border border-smitten-primary'}`}
          >
            Als Gast bestellen
          </button>
        </div>
      </div>
      )}

      {isGuest && (
        <div className="mt-4 space-y-3">
          <input
            type="text"
            placeholder="Name"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            className="w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
          />
          <input
            type="email"
            placeholder="E-Mail"
            value={guestEmail}
            onChange={e => setGuestEmail(e.target.value)}
            className="w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
          />
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-smitten-cream">
        {(() => {
          const netTotal = Math.round(totalCents / 1.07);
          const vatTotal = totalCents - netTotal;
          return (
            <div className="space-y-1 text-sm text-smitten-text">
              <div className="flex justify-between">
                <span>Zwischensumme (netto)</span>
                <span>{formatPrice(netTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>MwSt. 7%</span>
                <span>{formatPrice(vatTotal)}</span>
              </div>
            </div>
          );
        })()}
        <div className="flex items-center justify-between mt-2">
          <span className="text-lg font-medium text-smitten-text">Gesamtsumme (brutto)</span>
          <span className="text-2xl font-bold text-smitten-accent">
            {formatPrice(totalCents)}
          </span>
        </div>
        <button
          onClick={handleCheckout}
          disabled={isGuest && (!guestName || !guestEmail)}
          className="mt-4 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors disabled:opacity-50"
        >
          Zur Kasse
        </button>
      </div>
    </div>
  );
}
