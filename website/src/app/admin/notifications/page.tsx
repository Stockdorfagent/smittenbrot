'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { notificationTypeLabels, notificationChannelLabels } from '@/lib/adminLabels';

interface Notification {
  id: string;
  type: string;
  channel: string;
  sent_at: string;
  delivered: boolean;
  error: string | null;
  provider_message_id: string | null;
  order: { order_number: string | null; fulfillment_date: string } | null;
  customer: { email: string | null; name: string | null } | null;
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      // A type and a timestamp on their own could not be tied to anything —
      // so "did this order get its email?" was unanswerable. The order and the
      // customer come along now.
      .select('*, order:orders(order_number, fulfillment_date), customer:customers(email, name)')
      .order('sent_at', { ascending: false })
      .limit(100);
    if (data) setNotifications(data);
    setLoading(false);
  }

  if (loading) return <AdminLoading what="Benachrichtigungen" />;

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Benachrichtigungen</h1>

      {notifications.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
          Keine Benachrichtigungen vorhanden.
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-smitten-cream overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-smitten-cream bg-smitten-cream/50">
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Typ</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Bestellung</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Kunde</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Kanal</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Gesendet</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Status</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id} className="border-b border-smitten-cream last:border-0">
                  <td className="px-4 py-3 text-smitten-text">
                    {notificationTypeLabels[n.type] || n.type}
                  </td>
                  <td className="px-4 py-3 text-smitten-text/70">
                    {n.order?.order_number ? (
                      <span className="font-mono text-xs">{n.order.order_number}</span>
                    ) : (
                      // Either the message was not about an order at all
                      // (a reminder, a cancellation), or it predates the link.
                      <span className="text-smitten-text/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-smitten-text/70 text-xs">
                    {n.customer?.email ?? <span className="text-smitten-text/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-smitten-text">
                    {notificationChannelLabels[n.channel] || n.channel}
                  </td>
                  <td className="px-4 py-3 text-smitten-text">
                    {new Date(n.sent_at).toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={n.delivered ? 'green' : 'red'}>
                      {n.delivered ? 'Zugestellt' : 'Fehlgeschlagen'}
                    </StatusPill>
                    {n.error && (
                      <span className="ml-2 text-xs text-red-500">{n.error}</span>
                    )}
                    {n.provider_message_id && (
                      <span
                        className="block mt-1 text-[10px] text-smitten-text/30 font-mono"
                        title="Brevo-Message-ID — damit lässt sich die tatsächliche Zustellung bei Brevo prüfen. 'Zugestellt' heißt nur, dass Brevo die Mail angenommen hat."
                      >
                        {n.provider_message_id}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
