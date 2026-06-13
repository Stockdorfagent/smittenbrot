'use client';

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  const [customers, setCustomers] = useState<CustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'name' | 'last_order_date' | 'order_count' | 'total_spent_cents'>('last_order_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    // Load pickup locations for lookup
    const { data: locs } = await supabase.from('pickup_locations').select('id, name');
    const locMap: Record<string, string> = {};
    if (locs) locs.forEach(l => locMap[l.id] = l.name);
    setLocations(locMap);

    // Load customers with order stats
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (!customers) { setLoading(false); return; }

    // Get order counts per customer
    const { data: orderStats } = await supabase
      .from('orders')
      .select('customer_id, total_cents, fulfillment_date, status')
      .neq('status', 'cancelled');

    // Get active subscriptions per customer
    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select('customer_id')
      .eq('status', 'active');

    const activeSubSet = new Set((activeSubs || []).map(s => s.customer_id));

    // Aggregate order stats
    const statsMap: Record<string, { count: number; total: number; last: string | null }> = {};
    if (orderStats) {
      for (const o of orderStats) {
        if (!o.customer_id) continue;
        if (!statsMap[o.customer_id]) statsMap[o.customer_id] = { count: 0, total: 0, last: null };
        statsMap[o.customer_id].count++;
        statsMap[o.customer_id].total += Number(o.total_cents) || 0;
        if (o.fulfillment_date && (!statsMap[o.customer_id].last || o.fulfillment_date > statsMap[o.customer_id].last)) {
          statsMap[o.customer_id].last = o.fulfillment_date;
        }
      }
    }

    const result: CustomerWithStats[] = customers.map(c => {
      const stats = statsMap[c.id] || { count: 0, total: 0, last: null };
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        preferred_pickup_location_id: c.preferred_pickup_location_id,
        created_at: c.created_at,
        order_count: stats.count,
        total_spent_cents: stats.total,
        last_order_date: stats.last,
        subscription_active: activeSubSet.has(c.id),
      };
    });

    setCustomers(result);
    setLoading(false);
  }

  function formatPrice(cents: number): string {
    return `€${(cents / 100).toFixed(2).replace('.', ',')}`;
  }

  const filtered = customers
    .filter(c => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (c.name || '').toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortField === 'order_count') cmp = a.order_count - b.order_count;
      else if (sortField === 'total_spent_cents') cmp = a.total_spent_cents - b.total_spent_cents;
      else cmp = (a.last_order_date || '').localeCompare(b.last_order_date || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return <span className="text-smitten-text/20 ml-1">↕</span>;
    return <span className="text-smitten-primary ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Kunden...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Kunden</h1>
        <p className="text-sm text-smitten-text/40">{customers.length} gesamt</p>
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

      <div className="mt-4 bg-white rounded-xl border border-smitten-cream overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-smitten-cream bg-smitten-cream/50">
              <th
                className="text-left px-4 py-3 font-medium text-smitten-text cursor-pointer select-none hover:bg-smitten-cream"
                onClick={() => toggleSort('name')}
              >
                Name <SortIcon field="name" />
              </th>
              <th className="text-left px-4 py-3 font-medium text-smitten-text">E-Mail</th>
              <th className="text-left px-4 py-3 font-medium text-smitten-text">Abonnement</th>
              <th
                className="text-right px-4 py-3 font-medium text-smitten-text cursor-pointer select-none hover:bg-smitten-cream"
                onClick={() => toggleSort('order_count')}
              >
                Bestellungen <SortIcon field="order_count" />
              </th>
              <th
                className="text-right px-4 py-3 font-medium text-smitten-text cursor-pointer select-none hover:bg-smitten-cream"
                onClick={() => toggleSort('total_spent_cents')}
              >
                Gesamtumsatz <SortIcon field="total_spent_cents" />
              </th>
              <th
                className="text-right px-4 py-3 font-medium text-smitten-text cursor-pointer select-none hover:bg-smitten-cream"
                onClick={() => toggleSort('last_order_date')}
              >
                Letzte Bestellung <SortIcon field="last_order_date" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-smitten-text/40">
                  Keine Kunden gefunden.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <Fragment key={c.id}>
                  <tr
                    className="border-b border-smitten-cream last:border-0 hover:bg-smitten-cream/30 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <td className="px-4 py-3 text-smitten-text font-medium">
                      {c.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-smitten-text">{c.email}</td>
                    <td className="px-4 py-3">
                      {c.subscription_active ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Aktiv</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Kein</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-smitten-text">{c.order_count}</td>
                    <td className="px-4 py-3 text-right text-smitten-text">{formatPrice(c.total_spent_cents)}</td>
                    <td className="px-4 py-3 text-right text-smitten-text/60">
                      {c.last_order_date ? new Date(c.last_order_date + 'T00:00:00').toLocaleDateString('de-DE') : '—'}
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-smitten-cream/20">
                        <div className="text-xs text-smitten-text/60 space-y-1">
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
                              href={`/admin/orders?customer=${c.id}`}
                              className="text-smitten-primary hover:underline"
                            >
                              Bestellungen anzeigen →
                            </a>
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
