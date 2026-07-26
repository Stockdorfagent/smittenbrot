'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { PickupLocation } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [preferredLocation, setPreferredLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reminderEmail, setReminderEmail] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleDeleteAccount = async () => {
    setDeleting(true);
    const { error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      setDeleting(false);
      alert('Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.');
      return;
    }
    await supabase.auth.signOut();
    router.push('/');
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.push('/login'); return; }
      setUser(session.user);
      setEmail(session.user.email || '');

      const { data: customer } = await supabase
        .from('customers')
        .select('name, phone, preferred_pickup_location_id, reminder_email')
        .eq('id', session.user.id)
        .single();
      if (customer?.name) setName(customer.name);
      if (customer?.phone) setPhone(customer.phone);
      if (customer?.preferred_pickup_location_id) setPreferredLocation(customer.preferred_pickup_location_id);
      if (customer?.reminder_email != null) setReminderEmail(customer.reminder_email);

      const { data: locs } = await supabase
        .from('pickup_locations')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (locs) setLocations(locs);

      setLoading(false);
    });
  }, [router]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    await supabase.from('customers').upsert({
      id: user.id,
      email,
      name,
      phone: phone || null,
      preferred_pickup_location_id: preferredLocation || null,
      reminder_email: reminderEmail,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) {
    return <div className="max-w-xl mx-auto px-4 py-20 text-center text-smitten-text/40">Lädt...</div>;
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-display font-bold text-smitten-text">Mein Konto</h1>

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
          <p className="mt-1 text-smitten-text">{email}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            placeholder="Dein Name" />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Telefon (optional)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            placeholder="Für Rückfragen zur Abholung" />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Bevorzugter Abholort</label>
          <select value={preferredLocation} onChange={e => setPreferredLocation(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white">
            <option value="">– Bitte wählen –</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name} – {loc.address}</option>
            ))}
          </select>
        </div>

        {/* ── Reminder preferences ── */}
        <div className="pt-4 border-t border-smitten-cream">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={reminderEmail}
              onChange={e => setReminderEmail(e.target.checked)}
              className="mt-0.5 accent-smitten-accent" />
            <div>
              <p className="text-sm font-medium text-smitten-text">Bestell-Erinnerungen per E-Mail</p>
              <p className="text-xs text-smitten-text/60">
                Erinnerung, bevor deine Abo-Bestellung aufgegeben wird.
              </p>
            </div>
          </label>
          {!reminderEmail && (
            <p className="text-xs text-smitten-secondary mt-2">Du erhältst keine Bestell-Erinnerungen per E-Mail.</p>
          )}
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 disabled:opacity-50 transition-colors">
          {saving ? 'Wird gespeichert...' : saved ? '✓ Gespeichert' : 'Speichern'}
        </button>
      </div>

      <div className="mt-6 space-y-3">
        <Link href="/subscriptions"
          className="block bg-white rounded-xl border border-smitten-cream p-4 hover:border-smitten-primary/30 transition-colors">
          <p className="font-medium text-smitten-text">Meine Abos</p>
          <p className="text-sm text-smitten-text/60">Übersicht und Verwaltung</p>
        </Link>
        <Link href="/orders"
          className="block bg-white rounded-xl border border-smitten-cream p-4 hover:border-smitten-primary/30 transition-colors">
          <p className="font-medium text-smitten-text">Meine Bestellungen</p>
          <p className="text-sm text-smitten-text/60">Bestellverlauf und Rechnungen</p>
        </Link>
        {user?.email === 'sophia@smittenbrot.de' && (<>
        <Link href="/admin"
          className="block bg-white rounded-xl border border-smitten-cream p-4 hover:border-smitten-primary/30 transition-colors">
          <p className="font-medium text-smitten-text">Admin Bereich</p>
          <p className="text-sm text-smitten-text/60">Dashboard und Einstellungen</p>
        </Link>
        </>)}
        <button onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}
          className="w-full text-left bg-white rounded-xl border border-red-100 p-4 hover:border-red-200 transition-colors">
          <p className="font-medium text-red-600">Abmelden</p>
          <p className="text-sm text-red-400">Von deinem Konto abmelden</p>
        </button>
      </div>

      {/* ── Konto löschen (DSGVO Art. 17) ── */}
      <div className="mt-10 pt-6 border-t border-smitten-cream">
        {!confirmingDelete ? (
          <button onClick={() => setConfirmingDelete(true)}
            className="text-sm text-red-500 underline hover:text-red-600">
            Konto löschen
          </button>
        ) : (
          <div className="rounded-xl border border-red-200 bg-white p-5">
            <p className="font-medium text-smitten-text">Konto endgültig löschen?</p>
            <p className="mt-2 text-sm text-smitten-text/70">
              Dein Konto und deine persönlichen Daten (Profil, gespeicherte Zahlungsmethode, Abos)
              werden gelöscht. Rechnungen bewahren wir aus gesetzlichen Gründen (§ 147 AO) acht Jahre
              auf. Dies kann nicht rückgängig gemacht werden.
            </p>
            <div className="mt-4 flex gap-3">
              <button onClick={() => setConfirmingDelete(false)} disabled={deleting}
                className="flex-1 rounded-full border border-smitten-cream py-2.5 text-sm font-medium text-smitten-text hover:bg-smitten-cream disabled:opacity-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={handleDeleteAccount} disabled={deleting}
                className="flex-1 rounded-full bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deleting ? 'Wird gelöscht…' : 'Ja, löschen'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
