'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, Order, OrderItem, formatPrice } from '@/lib/types';
import Link from 'next/link';

interface ProductionRow {
  productName: string;
  quantity: number;
  capacity: number;
}

export default function AdminDashboard() {
  const [productionRows, setProductionRows] = useState<ProductionRow[]>([]);
  const [productionDay, setProductionDay] = useState<string>('');
  const [orderCount, setOrderCount] = useState<number>(0);
  const [fulfilledCount, setFulfilledCount] = useState<number>(0);
  const [activeSubs, setActiveSubs] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      // Find the earliest unfulfilled pickup day
      const { data: unfulfilledDates } = await supabase
        .from('orders')
        .select('fulfillment_date, status')
        .neq('status', 'cancelled')
        .order('fulfillment_date', { ascending: true });

      let targetDate = '';
      if (unfulfilledDates && unfulfilledDates.length > 0) {
        // Group by date
        const byDate: Record<string, { total: number; fulfilled: number }> = {};
        for (const o of unfulfilledDates) {
          if (!byDate[o.fulfillment_date]) {
            byDate[o.fulfillment_date] = { total: 0, fulfilled: 0 };
          }
          byDate[o.fulfillment_date].total++;
          if (o.status === 'fulfilled') {
            byDate[o.fulfillment_date].fulfilled++;
          }
        }
        // Find first date where NOT all orders are fulfilled
        const sortedDates = Object.keys(byDate).sort();
        for (const date of sortedDates) {
          const info = byDate[date];
          if (info.fulfilled < info.total) {
            targetDate = date;
            setOrderCount(info.total);
            setFulfilledCount(info.fulfilled);
            break;
          }
        }
        if (!targetDate && sortedDates.length > 0) {
          // All fulfilled — show the next future date
          targetDate = sortedDates[sortedDates.length - 1];
          const last = byDate[targetDate];
          setOrderCount(last.total);
          setFulfilledCount(last.total);
        }
      }

      if (targetDate) {
        setProductionDay(targetDate);
        const { data: products } = await supabase
          .from('products')
          .select('id, name, capacity');

        const { data: orders } = await supabase
          .from('orders')
          .select('id')
          .eq('fulfillment_date', targetDate)
          .neq('status', 'cancelled');

        const orderIds = (orders || []).map(o => o.id);
        let itemsMap: Record<string, number> = {};
        if (orderIds.length > 0) {
          const { data: items } = await supabase
            .from('order_items')
            .select('product_id, quantity')
            .in('order_id', orderIds);
          for (const item of items || []) {
            itemsMap[item.product_id] = (itemsMap[item.product_id] || 0) + item.quantity;
          }
        }

        const prodMap: Record<string, { name: string; capacity: number }> = {};
        for (const p of products || []) prodMap[p.id] = { name: p.name, capacity: p.capacity };

        const rows: ProductionRow[] = [];
        for (const [pid, qty] of Object.entries(itemsMap)) {
          const p = prodMap[pid];
          if (p) rows.push({ productName: p.name, quantity: qty, capacity: p.capacity });
        }
        rows.sort((a, b) => a.productName.localeCompare(b.productName));
        setProductionRows(rows);
      }

      const { count: subCount } = await supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active');
      setActiveSubs(subCount || 0);
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Dashboard...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Dashboard</h1>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 border border-smitten-cream">
          <p className="text-sm text-smitten-text/60">Aktive Abos</p>
          <p className="text-3xl font-display font-bold text-smitten-text mt-1">{activeSubs}</p>
        </div>
        {productionDay && (
        <div className="bg-white rounded-xl p-5 border border-smitten-cream">
          <p className="text-sm text-smitten-text/60">Fortschritt {productionDay}</p>
          <p className="text-3xl font-display font-bold text-smitten-text mt-1">{fulfilledCount} / {orderCount}</p>
          <p className="text-xs text-smitten-text/40 mt-1">abgeholt / gesamt</p>
        </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-display font-bold text-smitten-text">
          Produktionsliste — {productionDay || 'Keine aktuelle Produktion'}
        </h2>
        {productionRows.length === 0 ? (
          <div className="mt-4 bg-white rounded-xl p-6 border border-smitten-cream text-center text-smitten-text/60 text-sm">
            Keine Bestellungen für diesen Abholtag.
          </div>
        ) : (
          <div className="mt-4 bg-white rounded-xl border border-smitten-cream overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-smitten-cream bg-smitten-cream/50">
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Produkt</th>
                  <th className="text-right px-4 py-3 font-medium text-smitten-text">Menge</th>
                  <th className="text-right px-4 py-3 font-medium text-smitten-text">Kapazität</th>
                </tr>
              </thead>
              <tbody>
                {productionRows.map((row, i) => (
                  <tr key={i} className="border-b border-smitten-cream last:border-0">
                    <td className="px-4 py-3 text-smitten-text">{row.productName}</td>
                    <td className={`px-4 py-3 text-right font-medium ${
                      row.quantity > row.capacity ? 'text-red-600' : 'text-smitten-text'
                    }`}>
                      {row.quantity}
                    </td>
                    <td className="px-4 py-3 text-right text-smitten-text/60">{row.capacity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-display font-bold text-smitten-text">Schnellzugriff</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            href="/admin/orders"
            className="bg-white rounded-xl p-5 border border-smitten-cream hover:shadow-sm transition-shadow"
          >
            <p className="font-medium text-smitten-text">Bestellungen</p>
            <p className="text-xs text-smitten-text/40 mt-1">Verwalten und als abgeholt markieren</p>
          </Link>
          <Link
            href="/admin/products"
            className="bg-white rounded-xl p-5 border border-smitten-cream hover:shadow-sm transition-shadow"
          >
            <p className="font-medium text-smitten-text">Produkte</p>
            <p className="text-xs text-smitten-text/40 mt-1">Sortiment verwalten</p>
          </Link>
          <Link
            href="/admin/notifications"
            className="bg-white rounded-xl p-5 border border-smitten-cream hover:shadow-sm transition-shadow"
          >
            <p className="font-medium text-smitten-text">Benachrichtigungen</p>
            <p className="text-xs text-smitten-text/40 mt-1">Abholbereit-Meldungen senden</p>
          </Link>
          <Link
            href="/admin/settings"
            className="bg-white rounded-xl p-5 border border-smitten-cream hover:shadow-sm transition-shadow"
          >
            <p className="font-medium text-smitten-text">Einstellungen</p>
            <p className="text-xs text-smitten-text/40 mt-1">Wochenzyklus, Export</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
