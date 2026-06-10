'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Order, formatPrice } from '@/lib/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const statusLabels: Record<string, string> = {
  scheduled: 'Geplant',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderungsfenster',
  locked_for_production: 'Für Produktion gesperrt',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [user, setUser] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login');
        return;
      }
      setUser(session.user);
      supabase
        .from('orders')
        .select('*')
        .eq('customer_id', session.user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (data) setOrders(data);
          setLoading(false);
        });
    });
  }, []);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center text-smitten-text/40">
        Wird geladen...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-display font-bold text-smitten-text">
        Bestellungen
      </h1>

      {orders.length === 0 ? (
        <div className="mt-8 text-center py-10 text-smitten-text/60">
          <p>Du hast noch keine Bestellungen.</p>
          <Link
            href="/products"
            className="mt-4 inline-block bg-smitten-primary text-white px-6 py-2 rounded-full text-sm"
          >
            Jetzt bestellen
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map(order => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="block bg-white rounded-xl p-4 border border-smitten-cream hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-smitten-text">
                    Bestellung vom {new Date(order.created_at).toLocaleDateString('de-DE')}
                  </p>
                  <p className="text-sm text-smitten-text/60 mt-1">
                    Abholung: {new Date(order.fulfillment_date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-smitten-accent">
                    {formatPrice(order.total_cents)}
                  </p>
                  <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${
                    order.status === 'fulfilled' ? 'bg-green-100 text-green-700' :
                    order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                    order.status === 'locked_for_production' ? 'bg-amber-100 text-amber-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {statusLabels[order.status] || order.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
