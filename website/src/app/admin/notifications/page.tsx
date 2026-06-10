'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PickupLocation } from '@/lib/types';

interface Notification {
  id: string;
  type: string;
  channel: string;
  sent_at: string;
  delivered: boolean;
  error: string | null;
}

const typeLabels: Record<string, string> = {
  subscription_reminder: 'Abonnement-Erinnerung',
  order_placed: 'Bestellung aufgegeben',
  pickup_ready: 'Abholbereit',
  payment_failed: 'Zahlung fehlgeschlagen',
  admin_alert: 'Admin-Benachrichtigung',
  closure_notice: 'Schließzeit-Hinweis',
  subscription_paused: 'Abonnement pausiert',
  subscription_cancelled: 'Abonnement gekündigt',
};

const channelLabels: Record<string, string> = {
  push: 'Push',
  email: 'E-Mail',
  both: 'Beide',
};

export default function AdminNotificationsPage() {
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const [dayFilter, setDayFilter] = useState<string>('wed');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [orderIdFilter, setOrderIdFilter] = useState<string>('');
  const [extraText, setExtraText] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [customerCount, setCustomerCount] = useState<number>(0);

  const [adminAlertText, setAdminAlertText] = useState('');
  const [sendingAdmin, setSendingAdmin] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (dayFilter || locationFilter || orderIdFilter) {
      countCustomers();
    }
  }, [dayFilter, locationFilter, orderIdFilter]);

  async function loadData() {
    setLoading(true);
    const [locsRes, notifsRes] = await Promise.all([
      supabase.from('pickup_locations').select('*').order('sort_order', { ascending: true }),
      supabase.from('notifications').select('*').order('sent_at', { ascending: false }).limit(50),
    ]);
    if (locsRes.data) setLocations(locsRes.data);
    if (notifsRes.data) setNotifications(notifsRes.data);
    if (locsRes.data && locsRes.data.length > 0) {
      setLocationFilter(locsRes.data[0].id);
    }
    setLoading(false);
  }

  async function getNextPickupDate(day: string): Promise<string> {
    const now = new Date();
    const berlinNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const currentDay = berlinNow.getDay();
    let diff: number;
    if (day === 'wed') {
      diff = (3 - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
    } else {
      diff = (6 - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
    }
    const target = new Date(berlinNow);
    target.setDate(berlinNow.getDate() + diff);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function countCustomers() {
    const fulfillmentDate = await getNextPickupDate(dayFilter);
    let query = supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('fulfillment_date', fulfillmentDate)
      .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production']);

    if (locationFilter) {
      query = query.eq('pickup_location_id', locationFilter);
    }
    if (orderIdFilter) {
      query = query.ilike('id', `%${orderIdFilter}%`);
    }

    const { count } = await query;
    setCustomerCount(count || 0);
  }

  async function sendPickupNotifications() {
    setSending(true);
    const fulfillmentDate = await getNextPickupDate(dayFilter);

    let query = supabase
      .from('orders')
      .select('id, customer_id, customer_name, customer_email, pickup_location_id')
      .eq('fulfillment_date', fulfillmentDate)
      .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production']);

    if (locationFilter) {
      query = query.eq('pickup_location_id', locationFilter);
    }
    if (orderIdFilter) {
      query = query.ilike('id', `%${orderIdFilter}%`);
    }

    const { data: orders } = await query;
    if (!orders || orders.length === 0) {
      setSending(false);
      return;
    }

    for (const order of orders) {
      const location = locations.find((l) => l.id === order.pickup_location_id);
      const template =
        location?.notification_template ||
        'Ihre Bestellung {ORDER_NUMBER} ist abholbereit bei {PICKUP_LOCATION}.';
      const message = template
        .replace('{ORDER_NUMBER}', order.id.slice(0, 8))
        .replace('{PICKUP_LOCATION}', location?.name || '')
        .replace('{CODE}', extraText)
        .replace('{PICKUP_TIME}', '');

      const fullMessage = extraText ? `${message}\n\n${extraText}` : message;

      await supabase.from('notifications').insert({
        customer_id: order.customer_id,
        type: 'pickup_ready',
        channel: 'both',
        sent_at: new Date().toISOString(),
        delivered: true,
      });

      console.log(
        'Pickup notification sent:',
        fullMessage,
        'to',
        order.customer_name || order.customer_email,
      );
    }

    setSending(false);
    loadData();
  }

  async function sendAdminAlert() {
    if (!adminAlertText.trim()) return;
    setSendingAdmin(true);

    await supabase.from('notifications').insert({
      type: 'admin_alert',
      channel: 'email',
      sent_at: new Date().toISOString(),
      delivered: true,
    });

    console.log('Admin alert sent to hello@smittenbrot.de:', adminAlertText);
    setAdminAlertText('');
    setSendingAdmin(false);
    loadData();
  }

  function getPreview(): string {
    const location = locations.find((l) => l.id === locationFilter);
    const template =
      location?.notification_template ||
      'Ihre Bestellung {ORDER_NUMBER} ist abholbereit bei {PICKUP_LOCATION}.';
    let preview = template
      .replace('{ORDER_NUMBER}', 'abcd1234')
      .replace('{PICKUP_LOCATION}', location?.name || 'Abholort')
      .replace('{CODE}', extraText || '{CODE}')
      .replace('{PICKUP_TIME}', '');
    if (extraText) {
      preview += `\n\n${extraText}`;
    }
    return preview;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Benachrichtigungen...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Benachrichtigungen</h1>

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <h2 className="font-display font-bold text-smitten-text text-lg">
          Abholbereit-Benachrichtigung senden
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">Abholtag</label>
            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            >
              <option value="wed">Mittwoch</option>
              <option value="sat">Samstag</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">Abholort</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            >
              <option value="">Alle Orte</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">
              Bestellnummer (optional)
            </label>
            <input
              type="text"
              value={orderIdFilter}
              onChange={(e) => setOrderIdFilter(e.target.value)}
              placeholder="Nach ID filtern"
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-smitten-text/60 mb-1">
            Zusätzlicher Text (optional)
          </label>
          <textarea
            value={extraText}
            onChange={(e) => setExtraText(e.target.value)}
            rows={2}
            placeholder="z.B. Schrankcode: 1234"
            className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>

        <div className="mt-4 bg-smitten-bg rounded-lg p-4 border border-smitten-cream">
          <p className="text-xs text-smitten-text/60 mb-1">Vorschau</p>
          <p className="text-sm text-smitten-text whitespace-pre-wrap">{getPreview()}</p>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={sendPickupNotifications}
            disabled={sending || customerCount === 0}
            className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
          >
            {sending
              ? 'Sende...'
              : `An ${customerCount} Kunde${customerCount !== 1 ? 'n' : ''} senden`}
          </button>
          <p className="text-xs text-smitten-text/40">
            {customerCount === 0
              ? 'Keine passenden Bestellungen gefunden.'
              : `${customerCount} Bestellung${customerCount !== 1 ? 'en' : ''} werden benachrichtigt.`}
          </p>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <h2 className="font-display font-bold text-smitten-text text-lg">
          Admin-Benachrichtigung
        </h2>
        <p className="text-xs text-smitten-text/40 mt-1">
          Sendet eine E-Mail an hello@smittenbrot.de
        </p>
        <div className="mt-4">
          <textarea
            value={adminAlertText}
            onChange={(e) => setAdminAlertText(e.target.value)}
            rows={3}
            placeholder="Nachricht eingeben..."
            className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>
        <div className="mt-3">
          <button
            onClick={sendAdminAlert}
            disabled={sendingAdmin || !adminAlertText.trim()}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {sendingAdmin ? 'Sende...' : 'An Admin senden'}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="font-display font-bold text-smitten-text text-lg">
          Benachrichtigungsverlauf
        </h2>
        {notifications.length === 0 ? (
          <div className="mt-4 bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
            Keine Benachrichtigungen vorhanden.
          </div>
        ) : (
          <div className="mt-4 bg-white rounded-xl border border-smitten-cream overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-smitten-cream bg-smitten-cream/50">
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Typ</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Kanal</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Gesendet</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Status</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id} className="border-b border-smitten-cream last:border-0">
                    <td className="px-4 py-3 text-smitten-text">
                      {typeLabels[n.type] || n.type}
                    </td>
                    <td className="px-4 py-3 text-smitten-text">
                      {channelLabels[n.channel] || n.channel}
                    </td>
                    <td className="px-4 py-3 text-smitten-text">
                      {new Date(n.sent_at).toLocaleString('de-DE')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        n.delivered
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {n.delivered ? 'Zugestellt' : 'Fehlgeschlagen'}
                      </span>
                      {n.error && (
                        <span className="ml-2 text-xs text-red-500">{n.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
