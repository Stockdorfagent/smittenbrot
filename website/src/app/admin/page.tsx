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

function getBerlinDate(date?: Date): Date {
  const d = date || new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
}

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNextPickupInfo(): { date: Date; dayName: string; dateStr: string } {
  const berlinNow = getBerlinDate();
  const day = berlinNow.getDay();
  const hours = berlinNow.getHours();
  const mins = berlinNow.getMinutes();
  const totalMins = hours * 60 + mins;
  const cutoff = 22 * 60;

  let dWed = (3 - day + 7) % 7;
  let dSat = (6 - day + 7) % 7;
  if (dWed === 0) dWed = 7;
  if (dSat === 0) dSat = 7;

  let targetDate: Date;
  let targetName: string;

  if (day === 1 && totalMins >= cutoff) {
    targetDate = new Date(berlinNow);
    targetDate.setDate(berlinNow.getDate() + dSat);
    targetName = 'Samstag';
  } else if (day === 4 && totalMins >= cutoff) {
    targetDate = new Date(berlinNow);
    targetDate.setDate(berlinNow.getDate() + dWed);
    targetName = 'Mittwoch';
  } else if (dWed <= dSat) {
    targetDate = new Date(berlinNow);
    targetDate.setDate(berlinNow.getDate() + dWed);
    targetName = 'Mittwoch';
  } else {
    targetDate = new Date(berlinNow);
    targetDate.setDate(berlinNow.getDate() + dSat);
    targetName = 'Samstag';
  }

  return { date: targetDate, dayName: targetName, dateStr: formatDateStr(targetDate) };
}

function getThisWednesdayStr(): string {
  const berlinNow = getBerlinDate();
  const day = berlinNow.getDay();
  const d = (3 - day + 7) % 7;
  const wed = new Date(berlinNow);
  wed.setDate(berlinNow.getDate() + d);
  return formatDateStr(wed);
}

function getThisSaturdayStr(): string {
  const berlinNow = getBerlinDate();
  const day = berlinNow.getDay();
  const d = (6 - day + 7) % 7;
  const sat = new Date(berlinNow);
  sat.setDate(berlinNow.getDate() + d);
  return formatDateStr(sat);
}

export default function AdminDashboard() {
  const [productionRows, setProductionRows] = useState<ProductionRow[]>([]);
  const [wedCount, setWedCount] = useState<number>(0);
  const [satCount, setSatCount] = useState<number>(0);
  const [activeSubs, setActiveSubs] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const nextPickup = getNextPickupInfo();
      const wedStr = getThisWednesdayStr();
      const satStr = getThisSaturdayStr();

      const [
        { data: orders },
        { data: products },
        { count: subCount },
      ] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status')
          .eq('fulfillment_date', nextPickup.dateStr)
          .neq('status', 'cancelled'),
        supabase
          .from('products')
          .select('id, name, capacity'),
        supabase
          .from('subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ]);

      const orderIds = (orders || []).map((o) => o.id);
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

      const productMap: Record<string, { name: string; capacity: number }> = {};
      for (const p of products || []) {
        productMap[p.id] = { name: p.name, capacity: p.capacity };
      }

      const rows: ProductionRow[] = [];
      for (const [prodId, qty] of Object.entries(itemsMap)) {
        const prod = productMap[prodId];
        if (prod) {
          rows.push({ productName: prod.name, quantity: qty, capacity: prod.capacity });
        }
      }
      rows.sort((a, b) => a.productName.localeCompare(b.productName));

      setProductionRows(rows);

      const wedResult = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('fulfillment_date', wedStr)
        .neq('status', 'cancelled');
      setWedCount(wedResult.count || 0);

      const satResult = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('fulfillment_date', satStr)
        .neq('status', 'cancelled');
      setSatCount(satResult.count || 0);

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

  const nextPickup = getNextPickupInfo();

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Dashboard</h1>
      <p className="text-sm text-smitten-text/60 mt-1">
        Nächster Abholtag: {nextPickup.dayName}, {nextPickup.date.toLocaleDateString('de-DE')}
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 border border-smitten-cream">
          <p className="text-sm text-smitten-text/60">Mittwoch</p>
          <p className="text-3xl font-display font-bold text-smitten-text mt-1">{wedCount}</p>
          <p className="text-xs text-smitten-text/40 mt-1">Bestellungen</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-smitten-cream">
          <p className="text-sm text-smitten-text/60">Samstag</p>
          <p className="text-3xl font-display font-bold text-smitten-text mt-1">{satCount}</p>
          <p className="text-xs text-smitten-text/40 mt-1">Bestellungen</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-smitten-cream">
          <p className="text-sm text-smitten-text/60">Aktive Abos</p>
          <p className="text-3xl font-display font-bold text-smitten-text mt-1">{activeSubs}</p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-display font-bold text-smitten-text">
          Produktionsliste — {nextPickup.dayName}
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
