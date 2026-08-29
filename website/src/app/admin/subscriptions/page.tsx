'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { berlinDatePlusDays } from '@/lib/pickup';
import { formatPrice, type Subscription } from '@/lib/types';

/**
 * The admin view of subscriptions — until now the owner could see only a
 * COUNT of active Abos and had no way to inspect, pause or resume one from
 * the web. Actions go through /api/admin/subscriptions, which delegates to
 * the subscription-engine (order deletion/regeneration included) and writes
 * an audit row.
 */

interface SubRow extends Subscription {
  customers?: { name: string | null; email: string | null };
  pickup_locations?: { name: string };
  subscription_items?: { quantity: number; products?: { name: string; price_cents: number } }[];
}

const statusTone = {
  active: 'green',
  paused: 'amber',
  payment_failed: 'red',
  cancellation_pending: 'purple',
  cancelled: 'gray',
} as const;

const statusLabel: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  payment_failed: 'Zahlung fehlgeschlagen',
  cancellation_pending: 'Kündigung läuft',
  cancelled: 'Gekündigt',
};

const dayLabel: Record<string, string> = {
  wednesday: 'Mittwoch',
  saturday: 'Samstag',
  both: 'Mi + Sa',
};

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [pauseUntil, setPauseUntil] = useState('');

  useEffect(() => {
    loadSubs();
  }, []);

  async function loadSubs() {
    setLoading(true);
    const { data } = await supabase
      .from('subscriptions')
      .select(
        '*, customers(name, email), pickup_locations(name), subscription_items(quantity, products(name, price_cents))',
      )
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    setSubs((data ?? []) as unknown as SubRow[]);
    setLoading(false);
  }

  async function subAction(subId: string, action: 'pause' | 'resume', resumeDate?: string) {
    setBusyId(subId);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ subscription_id: subId, action, ...(resumeDate ? { resume_date: resumeDate } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !data.success) {
      showToast(data.error ?? 'Aktion fehlgeschlagen.');
      return;
    }
    showToast(action === 'pause' ? 'Abo pausiert (Bestellung entfernt).' : 'Abo läuft weiter.', 'success');
    setPausingId(null);
    setPauseUntil('');
    loadSubs();
  }

  const filtered = subs.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.customers?.name ?? '').toLowerCase().includes(q) ||
      (s.customers?.email ?? '').toLowerCase().includes(q)
    );
  });

  if (loading) return <AdminLoading what="Abos" />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Abos</h1>
        <p className="text-sm text-smitten-text/40">{subs.length} gesamt</p>
      </div>

      <div className="mt-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nach Name oder E-Mail suchen..."
          className="w-full max-w-md px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
          {subs.length === 0 ? 'Keine Abos vorhanden.' : 'Keine Abos gefunden.'}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((sub) => {
            const items = sub.subscription_items ?? [];
            const weekly = items.reduce(
              (sum, i) => sum + (i.products?.price_cents ?? 0) * i.quantity,
              0,
            );
            return (
              <div key={sub.id} className="bg-white rounded-xl border border-smitten-cream p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-smitten-text truncate">
                        {sub.customers?.name || sub.customers?.email || 'Unbekannt'}
                      </p>
                      <StatusPill tone={statusTone[sub.status] ?? 'blue'}>
                        {statusLabel[sub.status] ?? sub.status}
                      </StatusPill>
                      {sub.status === 'paused' && sub.paused_until && (
                        <span className="text-xs text-smitten-text/40">
                          bis {new Date(sub.paused_until + 'T12:00:00').toLocaleDateString('de-DE')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-smitten-text/40 mt-0.5">
                      {dayLabel[sub.pickup_day ?? ''] ?? sub.pickup_day}
                      {' · '}{sub.pickup_locations?.name ?? '—'}
                      {' · '}{items.map((i) => `${i.quantity}× ${i.products?.name ?? '?'}`).join(', ') || 'keine Artikel'}
                      {' · '}{formatPrice(weekly)}/Woche
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {sub.status === 'active' && (
                      <button
                        onClick={() => { setPausingId(pausingId === sub.id ? null : sub.id); setPauseUntil(''); }}
                        className="px-3 py-1.5 border border-smitten-cream text-smitten-text/60 text-xs rounded-lg hover:border-smitten-text/30 transition-colors"
                      >
                        Pausieren
                      </button>
                    )}
                    {(sub.status === 'paused' || sub.status === 'payment_failed') && (
                      <button
                        onClick={() => subAction(sub.id, 'resume')}
                        disabled={busyId === sub.id}
                        className="px-3 py-1.5 bg-smitten-primary text-white text-xs rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
                      >
                        {busyId === sub.id ? 'Wird fortgesetzt...' : 'Fortsetzen'}
                      </button>
                    )}
                  </div>
                </div>

                {pausingId === sub.id && (
                  <div className="mt-3 p-3 bg-smitten-cream rounded-lg flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs text-smitten-text mb-1">Pausieren bis (einschließlich)</label>
                      <input
                        type="date"
                        value={pauseUntil}
                        onChange={(e) => setPauseUntil(e.target.value)}
                        min={berlinDatePlusDays(1)}
                        className="rounded-lg border border-smitten-cream px-3 py-1.5 text-sm bg-white"
                      />
                    </div>
                    <button
                      onClick={() => subAction(sub.id, 'pause', pauseUntil)}
                      disabled={!pauseUntil || busyId === sub.id}
                      className="px-4 py-1.5 text-xs bg-smitten-primary text-white rounded-full hover:bg-smitten-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {busyId === sub.id ? 'Wird pausiert...' : 'Pause speichern'}
                    </button>
                    <p className="text-xs text-smitten-text/50 basis-full">
                      Entfernt die noch nicht berechnete Bestellung der pausierten Woche(n); die
                      Kundin sieht die Pause in App und Web.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
