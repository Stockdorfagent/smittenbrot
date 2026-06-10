'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Order, Subscription, SubscriptionItem, formatPrice } from '@/lib/types';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  preferred_pickup_location_id: string | null;
  created_at: string;
}

interface CustomerOrder extends Order {
  items?: { product_name: string; quantity: number }[];
}

export default function AdminCustomersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Record<string, CustomerOrder[]>>({});
  const [customerSubscriptions, setCustomerSubscriptions] = useState<
    Record<string, (Subscription & { items?: (SubscriptionItem & { product_name?: string })[] })[]>
  >({});
  const [loadingExpanded, setLoadingExpanded] = useState<Record<string, boolean>>({});

  async function search() {
    if (!searchTerm.trim()) return;
    setLoading(true);
    setSearched(true);

    const { data } = await supabase
      .from('customers')
      .select('*')
      .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .order('name', { ascending: true })
      .limit(20);

    setCustomers(data || []);
    setLoading(false);
    setExpandedId(null);
    setCustomerOrders({});
    setCustomerSubscriptions({});
  }

  async function toggleExpand(customerId: string) {
    if (expandedId === customerId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(customerId);

    if (!customerOrders[customerId]) {
      setLoadingExpanded((prev) => ({ ...prev, [customerId]: true }));

      const [ordersRes, subsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*')
          .eq('customer_id', customerId)
          .order('fulfillment_date', { ascending: false })
          .limit(20),
        supabase
          .from('subscriptions')
          .select('*')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
      ]);

      if (ordersRes.data) {
        const orderIds = ordersRes.data.map((o) => o.id);
        const { data: items } = await supabase
          .from('order_items')
          .select('order_id, product_id, quantity')
          .in('order_id', orderIds);

        const { data: products } = await supabase.from('products').select('id, name');
        const prodMap: Record<string, string> = {};
        for (const p of products || []) prodMap[p.id] = p.name;

        const ordersWithItems: CustomerOrder[] = ordersRes.data.map((o) => ({
          ...o,
          items: (items || [])
            .filter((i) => i.order_id === o.id)
            .map((i) => ({
              product_name: prodMap[i.product_id] || 'Unbekannt',
              quantity: i.quantity,
            })),
        }));
        setCustomerOrders((prev) => ({ ...prev, [customerId]: ordersWithItems }));
      }

      if (subsRes.data) {
        const subIds = subsRes.data.map((s) => s.id);
        const { data: subItems } = await supabase
          .from('subscription_items')
          .select('*, products(name)')
          .in('subscription_id', subIds);

        const { data: products } = await supabase.from('products').select('id, name');
        const prodMap: Record<string, string> = {};
        for (const p of products || []) prodMap[p.id] = p.name;

        const subsWithItems = subsRes.data.map((s) => ({
          ...s,
          items: (subItems || [])
            .filter((i) => i.subscription_id === s.id)
            .map((i) => ({
              id: i.id,
              subscription_id: i.subscription_id,
              product_id: i.product_id,
              quantity: i.quantity,
              product_name: prodMap[i.product_id] || 'Unbekannt',
            })),
        }));
        setCustomerSubscriptions((prev) => ({ ...prev, [customerId]: subsWithItems }));
      }

      setLoadingExpanded((prev) => ({ ...prev, [customerId]: false }));
    }
  }

  async function pauseSubscription(subscriptionId: string, currentStatus: string) {
    if (currentStatus === 'paused') {
      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'active', paused_until: null })
        .eq('id', subscriptionId);
      if (!error) refreshSubscriptions(expandedId!);
    } else {
      const days = prompt('Tage pausieren? (leer = unbegrenzt)');
      const pausedUntil = days
        ? new Date(Date.now() + Number(days) * 86400000).toISOString().split('T')[0]
        : null;
      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'paused', paused_until: pausedUntil })
        .eq('id', subscriptionId);
      if (!error) refreshSubscriptions(expandedId!);
    }
  }

  async function cancelSubscription(subscriptionId: string) {
    if (!confirm('Abonnement wirklich kündigen?')) return;
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscriptionId);
    if (!error) refreshSubscriptions(expandedId!);
  }

  async function refreshSubscriptions(customerId: string) {
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (subs) {
      const subIds = subs.map((s) => s.id);
      const { data: subItems } = await supabase
        .from('subscription_items')
        .select('*, products(name)')
        .in('subscription_id', subIds);

      const { data: products } = await supabase.from('products').select('id, name');
      const prodMap: Record<string, string> = {};
      for (const p of products || []) prodMap[p.id] = p.name;

      const subsWithItems = subs.map((s) => ({
        ...s,
        items: (subItems || [])
          .filter((i) => i.subscription_id === s.id)
          .map((i) => ({
            id: i.id,
            subscription_id: i.subscription_id,
            product_id: i.product_id,
            quantity: i.quantity,
            product_name: prodMap[i.product_id] || 'Unbekannt',
          })),
      }));
      setCustomerSubscriptions((prev) => ({ ...prev, [customerId]: subsWithItems }));
    }
  }

  const statusLabels: Record<string, string> = {
    active: 'Aktiv',
    paused: 'Pausiert',
    cancellation_pending: 'Kündigung ausstehend',
    cancelled: 'Gekündigt',
    payment_failed: 'Zahlung fehlgeschlagen',
  };

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    cancellation_pending: 'bg-orange-100 text-orange-700',
    cancelled: 'bg-red-100 text-red-700',
    payment_failed: 'bg-red-100 text-red-700',
  };

  const orderStatusLabels: Record<string, string> = {
    scheduled: 'Geplant',
    processing: 'In Bearbeitung',
    grace_period_open: 'Änderungsfenster',
    locked_for_production: 'Für Produktion gesperrt',
    fulfilled: 'Abgeholt',
    refunded: 'Rückerstattet',
    cancelled: 'Storniert',
  };

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Kunden suchen</h1>

      <div className="mt-6 flex items-center gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Name oder E-Mail-Adresse..."
          className="flex-1 max-w-md px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
        />
        <button
          onClick={search}
          disabled={loading}
          className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Suche...' : 'Suchen'}
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-smitten-text/40">Suche Kunden...</p>
        </div>
      )}

      {!loading && searched && customers.length === 0 && (
        <div className="mt-6 bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
          Keine Kunden gefunden.
        </div>
      )}

      {!loading && customers.length > 0 && (
        <div className="mt-6 space-y-3">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className="bg-white rounded-xl border border-smitten-cream overflow-hidden"
            >
              <button
                onClick={() => toggleExpand(customer.id)}
                className="w-full text-left p-4 hover:bg-smitten-bg/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-smitten-text truncate">
                      {customer.name || 'Kein Name'}
                    </p>
                    <p className="text-xs text-smitten-text/40 mt-0.5">
                      {customer.email}
                      {customer.phone && ` · ${customer.phone}`}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <span className="text-xs text-smitten-text/40">
                      {customerSubscriptions[customer.id]
                        ? `${customerSubscriptions[customer.id].length} Abonnement${customerSubscriptions[customer.id].length !== 1 ? 's' : ''}`
                        : ''}
                    </span>
                  </div>
                </div>
              </button>

              {expandedId === customer.id && (
                <div className="px-4 pb-4 border-t border-smitten-cream pt-3">
                  {loadingExpanded[customer.id] ? (
                    <p className="text-sm text-smitten-text/40 py-4">Lädt Details...</p>
                  ) : (
                    <>
                      {customerSubscriptions[customer.id] &&
                        customerSubscriptions[customer.id].length > 0 && (
                          <div className="mb-4">
                            <h3 className="text-sm font-medium text-smitten-text mb-2">
                              Abonnements
                            </h3>
                            {customerSubscriptions[customer.id].map((sub) => (
                              <div
                                key={sub.id}
                                className="bg-smitten-bg rounded-lg p-3 mb-2 border border-smitten-cream"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                          statusColors[sub.status] || 'bg-gray-100 text-gray-600'
                                        }`}
                                      >
                                        {statusLabels[sub.status] || sub.status}
                                      </span>
                                      {sub.paused_until && (
                                        <span className="text-xs text-smitten-text/40">
                                          Pausiert bis{' '}
                                          {new Date(sub.paused_until).toLocaleDateString('de-DE')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 text-xs text-smitten-text">
                                      {(sub.items || []).map((item) => (
                                        <span key={item.id} className="mr-3">
                                          {item.product_name || 'Unbekannt'} × {item.quantity}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        pauseSubscription(sub.id, sub.status);
                                      }}
                                      className="px-2 py-1 text-xs rounded-lg border border-smitten-cream text-smitten-text/60 hover:bg-smitten-bg transition-colors"
                                    >
                                      {sub.status === 'paused' ? 'Fortsetzen' : 'Pausieren'}
                                    </button>
                                    {sub.status !== 'cancelled' && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelSubscription(sub.id);
                                        }}
                                        className="px-2 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                                      >
                                        Kündigen
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                      {customerOrders[customer.id] &&
                        customerOrders[customer.id].length > 0 && (
                          <div>
                            <h3 className="text-sm font-medium text-smitten-text mb-2">
                              Bestellungen
                            </h3>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-smitten-text/40 border-b border-smitten-cream">
                                    <th className="text-left pb-2">Datum</th>
                                    <th className="text-left pb-2">Typ</th>
                                    <th className="text-left pb-2">Artikel</th>
                                    <th className="text-right pb-2">Summe</th>
                                    <th className="text-left pb-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {customerOrders[customer.id].map((order) => (
                                    <tr
                                      key={order.id}
                                      className="border-b border-smitten-cream last:border-0"
                                    >
                                      <td className="py-2 pr-3 text-smitten-text whitespace-nowrap">
                                        {new Date(order.fulfillment_date).toLocaleDateString(
                                          'de-DE',
                                        )}
                                      </td>
                                      <td className="py-2 pr-3 text-smitten-text">
                                        {order.order_type === 'subscription'
                                          ? 'Abonnement'
                                          : 'Einmalig'}
                                      </td>
                                      <td className="py-2 pr-3 text-smitten-text">
                                        {(order.items || [])
                                          .map((i) => `${i.product_name} × ${i.quantity}`)
                                          .join(', ')}
                                      </td>
                                      <td className="py-2 pr-3 text-right text-smitten-text font-medium">
                                        {formatPrice(order.total_cents)}
                                      </td>
                                      <td className="py-2 text-smitten-text">
                                        <span
                                          className={`text-xs px-2 py-0.5 rounded-full ${
                                            order.status === 'fulfilled'
                                              ? 'bg-green-100 text-green-700'
                                              : order.status === 'cancelled'
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-blue-100 text-blue-700'
                                          }`}
                                        >
                                          {orderStatusLabels[order.status] || order.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                      {(!customerOrders[customer.id] ||
                        customerOrders[customer.id].length === 0) &&
                        (!customerSubscriptions[customer.id] ||
                          customerSubscriptions[customer.id].length === 0) && (
                          <p className="text-sm text-smitten-text/40 py-4 text-center">
                            Keine Bestellungen oder Abonnements.
                          </p>
                        )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
