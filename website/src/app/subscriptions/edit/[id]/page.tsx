'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Product, PickupLocation, formatPrice } from '@/lib/types';
import Link from 'next/link';

export default function SubscriptionEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const subId = params?.id as string;

  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push('/login?redirect=/subscriptions'); return; }

      const [{ data: sub }, { data: cycleData }, { data: locData }] = await Promise.all([
        supabase
          .from('subscriptions')
          .select('pickup_day, pickup_location_id, subscription_items(product_id, quantity)')
          .eq('id', subId)
          .single(),
        supabase.from('week_cycle').select('current_week').order('created_at', { ascending: false }).limit(1).single(),
        supabase.from('pickup_locations').select('*').eq('active', true).order('sort_order', { ascending: true }),
      ]);

      if (!sub) { setError('Abo nicht gefunden.'); setLoading(false); return; }
      const day = (sub.pickup_day as 'wednesday' | 'saturday') ?? 'wednesday';
      setLocations(locData ?? []);
      setSelectedLocation(sub.pickup_location_id ?? (locData?.[0]?.id ?? ''));

      const q: Record<string, number> = {};
      for (const it of (sub.subscription_items ?? []) as { product_id: string; quantity: number }[]) {
        q[it.product_id] = it.quantity;
      }
      setQuantities(q);

      const cycle = cycleData?.current_week ?? 'A';
      const { data: prodData } = await supabase
        .from('products').select('*').eq('active', true).order('sort_order', { ascending: true });
      const filtered = (prodData ?? []).filter((p) => {
        if (day === 'wednesday' && !p.available_wed) return false;
        if (day === 'saturday' && !p.available_sat) return false;
        if (p.cycle === 'week_a') return cycle === 'A';
        if (p.cycle === 'week_b') return cycle === 'B';
        if (p.cycle === 'hidden') return false;
        return true;
      });
      setProducts(filtered);
      setLoading(false);
    })();
  }, [subId, router]);

  const setQty = (id: string, delta: number) =>
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));

  const total = products.reduce((s, p) => s + p.price_cents * (quantities[p.id] || 0), 0);

  async function handleSave() {
    setError('');
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity }));
    if (items.length === 0) { setError('Wähle mindestens ein Produkt aus.'); return; }
    if (!selectedLocation) { setError('Wähle einen Abholort.'); return; }

    setSaving(true);
    const { data, error: fnErr } = await supabase.functions.invoke('subscription-engine/update-subscription', {
      body: { subscription_id: subId, items, pickup_location_id: selectedLocation },
    });
    setSaving(false);
    if (fnErr) { setError('Änderung fehlgeschlagen. Bitte später erneut versuchen.'); return; }
    const applied = (data as { applied_this_week?: boolean } | null)?.applied_this_week;
    alert(
      applied
        ? 'Abo aktualisiert. Deine anstehende, noch nicht berechnete Bestellung wurde bereits angepasst.'
        : 'Abo aktualisiert. Die nächste Lieferung ist bereits fixiert – deine Änderung gilt ab der Lieferung danach.',
    );
    router.push('/subscriptions');
  }

  if (loading) return <main className="max-w-2xl mx-auto px-4 py-12 text-smitten-text/60">Wird geladen…</main>;

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <Link href="/subscriptions" className="text-sm text-smitten-text/60 hover:text-smitten-text">← Zurück zu meinen Abos</Link>
      <h1 className="mt-3 text-2xl font-bold text-smitten-text">Abo bearbeiten</h1>
      <p className="mt-1 text-sm text-smitten-text/60">Ändere Produkte, Mengen oder den Abholort. Die Änderung gilt für jede Lieferung.</p>

      <div className="mt-6 space-y-2">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg border border-smitten-cream bg-white px-4 py-3">
            <div>
              <p className="font-medium text-smitten-text">{p.name}</p>
              <p className="text-sm text-smitten-text/60">{formatPrice(p.price_cents)}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setQty(p.id, -1)} disabled={(quantities[p.id] || 0) === 0}
                className="w-9 h-9 rounded-full bg-smitten-cream text-smitten-text text-lg disabled:opacity-40">−</button>
              <span className="w-6 text-center font-medium">{quantities[p.id] || 0}</span>
              <button onClick={() => setQty(p.id, 1)}
                className="w-9 h-9 rounded-full bg-smitten-primary text-white text-lg">+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <label className="block text-sm font-medium text-smitten-text/70 mb-1">Abholort</label>
        <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}
          className="w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white">
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name} – {l.address}</option>)}
        </select>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="font-semibold text-smitten-text">Gesamt pro Lieferung</span>
        <span className="text-lg font-bold text-smitten-text">{formatPrice(total)}</span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button onClick={handleSave} disabled={saving}
        className="mt-6 w-full bg-smitten-primary text-white py-3 rounded-full font-medium hover:bg-smitten-primary/90 disabled:opacity-50 transition-colors">
        {saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
      </button>
    </main>
  );
}
