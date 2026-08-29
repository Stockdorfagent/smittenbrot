'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { formatPrice } from '@/lib/types';

interface CustomerWithStats {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  preferred_pickup_location_id: string | null;
  created_at: string;
  order_count: number;
  total_spent_cents: number;
  last_order_date: string | null;
  subscription_active: boolean;
}

export default function AdminCustomersPage() {
  const [rows, setRows] = useState<CustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const { data: locs } = await supabase.from('pickup_locations').select('id, name');
      const locMap: Record<string, string> = {};
      if (locs) locs.forEach((l: any) => (locMap[l.id] = l.name));
      setLocations(locMap);

      const { data: customers } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (!customers || customers.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const { data: orderStats } = await supabase
        .from('orders')
        .select('customer_id, total_cents, fulfillment_date');

      const { data: activeSubs } = await supabase
        .from('subscriptions')
        .select('customer_id')
        .eq('status', 'active');

      const subSet = new Set((activeSubs || []).map((s: any) => s.customer_id));

      const counts: Record<string, { n: number; total: number; last: string | null }> = {};
      if (orderStats) {
        for (const o of orderStats as any[]) {
          if (!o.customer_id) continue;
          if (!counts[o.customer_id]) counts[o.customer_id] = { n: 0, total: 0, last: null };
          const cid = counts[o.customer_id]!;
          cid.n++;
          cid.total += Number(o.total_cents) || 0;
          if (o.fulfillment_date && (!cid.last || o.fulfillment_date > cid.last)) {
            cid.last = o.fulfillment_date;
          }
        }
      }

      const result: CustomerWithStats[] = customers.map((c: any) => {
        const s = counts[c.id] || { n: 0, total: 0, last: null };
        return {
          id: c.id,
          email: c.email,
          name: c.name,
          phone: c.phone,
          preferred_pickup_location_id: c.preferred_pickup_location_id,
          created_at: c.created_at,
          order_count: s.n,
          total_spent_cents: s.total,
          last_order_date: s.last,
          subscription_active: subSet.has(c.id),
        };
      });

      setRows(result);
      setLoading(false);
    } catch (err: any) {
      console.error('Customers page error:', err);
      setError(err?.message || 'Unknown error');
      setLoading(false);
    }
  }

  const filtered = rows
    .filter((c) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (c.name || '').toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });

  if (loading) return <AdminLoading what="Kunden" />;

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md text-center">
          <p className="text-red-700 text-sm font-medium">Fehler beim Laden</p>
          <p className="text-red-500 text-xs mt-1">{error}</p>
          <button
            onClick={loadData}
            className="mt-4 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Kunden</h1>
        <p className="text-sm text-smitten-text/40">{rows.length} gesamt</p>
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
          {rows.length === 0
            ? 'Keine Kunden vorhanden.'
            : 'Keine Kunden gefunden.'}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-xl border border-smitten-cream overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-smitten-cream/30 transition-colors"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-smitten-text truncate">
                        {c.name || '—'}
                      </p>
                      {c.subscription_active && (
                        <StatusPill tone="green" className="shrink-0">
                          Abo
                        </StatusPill>
                      )}
                    </div>
                    <p className="text-xs text-smitten-text/60 mt-0.5">{c.email}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-sm text-smitten-text">{formatPrice(c.total_spent_cents)}</p>
                    <p className="text-xs text-smitten-text/40">
                      {c.order_count} Bestellung{c.order_count !== 1 ? 'en' : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-smitten-text/40">
                  <span>
                    Letzte: {c.last_order_date
                      ? new Date(c.last_order_date + 'T00:00:00').toLocaleDateString('de-DE')
                      : '—'}
                  </span>
                </div>
              </div>

              {expandedId === c.id && (
                <div className="px-4 pb-4 border-t border-smitten-cream">
                  <div className="pt-3 text-xs text-smitten-text/60 space-y-1">
                    <p><strong>Kunde seit:</strong> {new Date(c.created_at).toLocaleDateString('de-DE')}</p>
                    <p><strong>Telefon:</strong> {c.phone || '—'}</p>
                    <p>
                      <strong>Bevorzugter Abholort:</strong>{' '}
                      {c.preferred_pickup_location_id
                        ? locations[c.preferred_pickup_location_id] || 'Unbekannt'
                        : '—'}
                    </p>
                    <p className="mt-2">
                      <a
                        href={`/admin/orders?kunde=${encodeURIComponent(c.email)}`}
                        className="text-smitten-primary hover:underline"
                      >
                        Bestellungen anzeigen →
                      </a>
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
