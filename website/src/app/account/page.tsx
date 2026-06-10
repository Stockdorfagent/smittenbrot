'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PickupLocation } from '@/lib/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email?: string; user_metadata?: { full_name?: string; phone?: string } } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLocation, setPreferredLocation] = useState('');
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login');
        return;
      }
      setUser(session.user);
      setName(session.user.user_metadata?.full_name || '');
      setPhone(session.user.user_metadata?.phone || '');

      supabase
        .from('customers')
        .select('preferred_pickup_location_id')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.preferred_pickup_location_id) {
            setPreferredLocation(data.preferred_pickup_location_id);
          }
        });

      supabase
        .from('pickup_locations')
        .select('*')
        .eq('active', true)
        .order('sort_order')
        .then(({ data }) => {
          if (data) setLocations(data);
        });
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    await supabase.auth.updateUser({ data: { full_name: name, phone } });

    if (user) {
      await supabase.from('customers').upsert({
        id: user.id,
        name,
        phone,
        preferred_pickup_location_id: preferredLocation || null,
        email: user.email,
      });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (!user) return null;

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-display font-bold text-smitten-text">
        Mein Konto
      </h1>

      <form onSubmit={handleSave} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
          <input
            type="email"
            value={user.email || ''}
            disabled
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-gray-50 text-smitten-text/60"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Telefon</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Bevorzugter Abholort</label>
          <select
            value={preferredLocation}
            onChange={e => setPreferredLocation(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
          >
            <option value="">Bitte wählen</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>

        {saved && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            Gespeichert!
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-smitten-primary text-white py-3 rounded-full font-medium hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Wird gespeichert...' : 'Speichern'}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        <Link
          href="/orders"
          className="block text-center bg-white border border-smitten-cream py-3 rounded-full text-sm font-medium hover:bg-smitten-cream transition-colors"
        >
          Bestellungen ansehen
        </Link>
        <Link
          href="/subscriptions"
          className="block text-center bg-white border border-smitten-cream py-3 rounded-full text-sm font-medium hover:bg-smitten-cream transition-colors"
        >
          Abos verwalten
        </Link>
      </div>

      <div className="mt-8 pt-6 border-t border-smitten-cream">
        <button
          onClick={handleLogout}
          className="w-full border border-red-200 text-red-600 py-2.5 rounded-full text-sm font-medium hover:bg-red-50 transition-colors"
        >
          Abmelden
        </button>
      </div>
    </div>
  );
}
