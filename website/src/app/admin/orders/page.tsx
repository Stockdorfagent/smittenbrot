'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { Order, OrderItem, PickupLocation, formatPrice } from '@/lib/types';
import Link from 'next/link';
import { berlinTodayISO } from '@/lib/pickup';
import { StatusPill } from '@/components/admin/StatusPill';
import {
  notificationTypeLabels,
  notificationChannelLabels,
  orderStatusAdminLabels,
  paymentStatusLabels,
} from '@/lib/adminLabels';

interface OrderWithItems extends Order {
  items?: (OrderItem & { product_name?: string })[];
  location_name?: string;
}

interface OrderNotification {
  id: string;
  order_id: string;
  type: string;
  channel: string;
  sent_at: string;
  delivered: boolean;
  error: string | null;
  provider_message_id: string | null;
}

/**
 * The day the order_id link started being written. Before this, notifications
 * were logged but not tied to an order, so an empty list for an older order
 * means "cannot tell", NOT "nothing was sent" — a distinction worth making
 * loudly, since the whole point of this panel is answering that question.
 */
const NOTIFICATION_LINK_SINCE = '2026-08-26';

/**
 * Guard against ticking off an order that is not ready to be ticked off.
 *
 * Marking an order fulfilled removes it from the 22:00 charge run, which only
 * looks at `scheduled` and `grace_period_open`. So doing it to an unpaid order
 * means that order will never be charged — quietly, with no error anywhere.
 * It has already happened once, to a subscription order announced seven days
 * before its pickup date.
 *
 * Unpaid is a hard stop for the notification button (also enforced server-side)
 * and a loud confirmation for the silent one, because handing over unpaid bread
 * is a thing that legitimately happens now and then. A pickup date in the
 * future is always worth a second look: it is the shape of a misclick on the
 * wrong row.
 */
function confirmTickOff(
  order: { payment_status: string; fulfillment_date: string; customer_name: string | null },
  { allowUnpaid }: { allowUnpaid: boolean },
): boolean {
  if (order.payment_status !== 'paid') {
    if (!allowUnpaid) {
      alert(
        'Diese Bestellung ist noch nicht bezahlt.\n\n' +
        'Markiere zuerst die Zahlung als erhalten. Sonst wird die Bestellung ' +
        'nie belastet, denn abgehakte Bestellungen werden vom Einzug übersprungen.',
      );
      return false;
    }
    if (!confirm(
      'ACHTUNG: Diese Bestellung ist nicht bezahlt.\n\n' +
      'Wenn du sie als abgeholt markierst, wird sie nie belastet. ' +
      'Trotzdem abhaken?',
    )) return false;
  }

  if (order.fulfillment_date > berlinTodayISO()) {
    const datum = new Date(order.fulfillment_date + 'T12:00:00')
      .toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!confirm(
      `Der Abholtag dieser Bestellung ist erst ${datum}.\n\n` +
      'Hast du die richtige Bestellung erwischt?',
    )) return false;
  }
  return true;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dayFilter, setDayFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notificationsByOrder, setNotificationsByOrder] = useState<Record<string, OrderNotification[]>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [invoiceFrom, setInvoiceFrom] = useState('');
  const [invoiceTo, setInvoiceTo] = useState('');
  const [hideTestOrders, setHideTestOrders] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPast]);

  async function loadData() {
    setLoading(true);
    const [ordersRes, locsRes] = await Promise.all([
      // Default to today and later: the unbounded version pulled every order
      // ever made (plus all their items and notifications) on every visit.
      // "Vergangene anzeigen" fetches the full history on demand.
      (showPast
        ? supabase.from('orders').select('*')
        : supabase.from('orders').select('*').gte('fulfillment_date', berlinTodayISO())
      )
        .order('fulfillment_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('pickup_locations').select('*'),
    ]);

    if (locsRes.data) setLocations(locsRes.data);

    if (ordersRes.data) {
      const orderIds = ordersRes.data.map((o) => o.id);

      // Which messages went out for these orders — so "did he get an email?"
      // is answered on the order itself instead of by eyeballing timestamps in
      // a separate list.
      const { data: notifs } = await supabase
        .from('notifications')
        .select('id, order_id, type, channel, sent_at, delivered, error, provider_message_id')
        .in('order_id', orderIds)
        .order('sent_at', { ascending: true });
      const byOrder: Record<string, OrderNotification[]> = {};
      for (const n of (notifs ?? []) as OrderNotification[]) {
        (byOrder[n.order_id] ??= []).push(n);
      }
      setNotificationsByOrder(byOrder);
      // Left join: the product name comes back on the item row itself — no
      // second products query, no id→name map. Left (not inner) so an item
      // never silently disappears if its product row ever goes missing.
      const { data: items } = await supabase
        .from('order_items')
        .select('*, products(name)')
        .in('order_id', orderIds);

      const locMap: Record<string, string> = {};
      for (const l of locsRes.data || []) locMap[l.id] = l.name;

      const ordersWithItems: OrderWithItems[] = ordersRes.data.map((order) => ({
        ...order,
        items: (items || [])
          .filter((i) => i.order_id === order.id)
          .map((i) => ({
            id: i.id,
            order_id: i.order_id,
            product_id: i.product_id,
            quantity: i.quantity,
            unit_price_cents: i.unit_price_cents,
            product_name: (i.products as { name?: string } | null)?.name || 'Unbekannt',
          })),
        location_name: locMap[order.pickup_location_id] || 'Unbekannt',
      }));
      setOrders(ordersWithItems);
    }
    setLoading(false);
  }

  /**
   * Both order actions go through /api/admin/order-actions: server-side
   * checks plus an audit_log row naming who did it. Direct browser writes to
   * `orders` are what once let an announced order silently never be charged —
   * and marking paid issues an invoice number, which must leave a trace.
   */
  async function orderAction(
    orderId: string,
    action: 'mark_fulfilled' | 'mark_paid',
    opts: { allowUnpaid?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/order-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ order_id: orderId, action, allow_unpaid: !!opts.allowUnpaid }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.error ?? 'Aktion fehlgeschlagen. Bitte erneut versuchen.');
      return null;
    }
    return (data.order as Record<string, unknown>) ?? {};
  }

  async function downloadInvoices() {
    if (!invoiceFrom) return;
    const to = invoiceTo || '2099-12-31';
    const { data: orders } = await supabase
      .from('orders')
      .select('id, invoice_number')
      .gte('fulfillment_date', invoiceFrom)
      .lte('fulfillment_date', to)
      .not('invoice_number', 'is', null)
      .neq('status', 'cancelled');
    if (!orders || orders.length === 0) {
      alert('Keine Rechnungen im gewählten Zeitraum.');
      return;
    }
    for (const o of orders) {
      window.open(`/orders/${o.id}`, '_blank');
    }
  }

  // Paid orders are numbered TEST-#00001… while test-invoice-mode is on
  // (migration 008) — those are app testers, not customers. Hidden by default
  // so the list reflects real demand; the toggle brings them back for cleanup.
  const testOrderCount = orders.filter((o) =>
    (o.order_number ?? '').startsWith('TEST-'),
  ).length;

  const filteredOrders = orders.filter((o) => {
    if (hideTestOrders && (o.order_number ?? '').startsWith('TEST-')) return false;
    if (statusFilter && o.status !== statusFilter) return false;
    if (locationFilter && o.pickup_location_id !== locationFilter) return false;
    if (dayFilter) {
      const d = new Date(o.fulfillment_date);
      const dayName = d.toLocaleDateString('de-DE', { weekday: 'long' });
      if (dayFilter === 'wed' && dayName !== 'Mittwoch') return false;
      if (dayFilter === 'sat' && dayName !== 'Samstag') return false;
    }
    return true;
  });

  if (loading) return <AdminLoading what="Bestellungen" />;

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Bestellungen</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
        >
          <option value="">Alle Status</option>
          {Object.entries(orderStatusAdminLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
        >
          <option value="">Alle Tage</option>
          <option value="wed">Mittwoch</option>
          <option value="sat">Samstag</option>
        </select>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
        >
          <option value="">Alle Orte</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        {testOrderCount > 0 && (
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-smitten-cream bg-white text-sm text-smitten-text">
            <input
              type="checkbox"
              checked={hideTestOrders}
              onChange={(e) => setHideTestOrders(e.target.checked)}
              className="accent-smitten-primary"
            />
            Testbestellungen ausblenden ({testOrderCount})
          </label>
        )}
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-smitten-cream bg-white text-sm text-smitten-text">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            className="accent-smitten-primary"
          />
          Vergangene anzeigen
        </label>
      </div>

      <div className="mt-4 p-4 bg-white rounded-xl border border-smitten-cream flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-smitten-text/60 mb-1">Rechnungen von</label>
          <input type="date" value={invoiceFrom} onChange={e => setInvoiceFrom(e.target.value)}
            className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
        </div>
        <div>
          <label className="block text-xs text-smitten-text/60 mb-1">bis</label>
          <input type="date" value={invoiceTo} onChange={e => setInvoiceTo(e.target.value)}
            className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
        </div>
        <button onClick={downloadInvoices}
          className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors">
          Rechnungen öffnen ({invoiceFrom ? `ab ${invoiceFrom}` : 'Datum wählen'})
        </button>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
          Keine Bestellungen gefunden.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filteredOrders.map((order) => {
            const netTotal = Math.round(order.total_cents / 1.07);
            const vatTotal = order.total_cents - netTotal;
            return (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-smitten-cream overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  className="w-full text-left p-4 hover:bg-smitten-bg/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-smitten-text truncate">
                        {order.customer_name || order.customer_email || 'Gast'}
                      </p>
                      <p className="text-xs text-smitten-text/40 mt-0.5">
                        <strong className="text-smitten-text/60">{order.order_number}</strong>
                        {' · '}Abholung {new Date(order.fulfillment_date).toLocaleDateString('de-DE')}
                        {' · '}bestellt {new Date(order.created_at).toLocaleDateString('de-DE')}
                        {' · '}{order.location_name}
                      </p>
                    </div>
                    <div className="text-right ml-4 flex items-center gap-3">
                      {/* Invoice link */}
                      {order.invoice_number ? (
                        <Link
                          href={`/orders/${order.id}`}
                          className="text-xs font-mono text-smitten-secondary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {order.invoice_number}
                        </Link>
                      ) : (
                        <span className="text-[10px] text-smitten-text/30 italic">
                          Wird bei Produktion zugewiesen
                        </span>
                      )}
                      <StatusPill tone={
                        order.status === 'fulfilled' ? 'green' :
                        order.status === 'cancelled' ? 'red' :
                        order.status === 'locked_for_production' ? 'amber' :
                        order.status === 'refunded' ? 'purple' : 'blue'
                      }>
                        {orderStatusAdminLabels[order.status] || order.status}
                      </StatusPill>
                      <StatusPill tone={
                        order.payment_status === 'paid' ? 'green' :
                        order.payment_status === 'failed' ? 'red' : 'gray'
                      }>
                        {paymentStatusLabels[order.payment_status] || order.payment_status}
                      </StatusPill>
                      <div className="text-right">
                        <span className="text-sm font-medium text-smitten-accent">
                          {formatPrice(order.total_cents)}
                        </span>
                        {/* VAT breakdown — tiny */}
                        <div className="text-[10px] text-smitten-text/40 leading-tight">
                          netto {formatPrice(netTotal)} · MwSt. {formatPrice(vatTotal)}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>

                {expandedId === order.id && (
                  <div className="px-4 pb-4 border-t border-smitten-cream pt-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-smitten-text/40">
                          <th className="text-left pb-1">Produkt</th>
                          <th className="text-right pb-1">Menge</th>
                          <th className="text-right pb-1">Preis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(order.items || []).map((item) => (
                          <tr key={item.id}>
                            <td className="py-1 text-smitten-text">{item.product_name}</td>
                            <td className="py-1 text-right text-smitten-text">{item.quantity}</td>
                            <td className="py-1 text-right text-smitten-text">{formatPrice(item.unit_price_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* What the customer was actually told about THIS order.
                        The question that prompted this panel — "he says he got
                        no email" — used to need two lists and a lot of squinting
                        at timestamps. */}
                    <div className="mt-4 border-t border-smitten-cream pt-3">
                      <p className="text-xs font-medium text-smitten-text/60">Benachrichtigungen</p>
                      {(notificationsByOrder[order.id] ?? []).length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {(notificationsByOrder[order.id] ?? []).map((n) => (
                            <li key={n.id} className="text-xs text-smitten-text/70">
                              <span className={n.delivered ? 'text-green-700' : 'text-red-600'}>
                                {n.delivered ? '✓' : '✗'}
                              </span>{' '}
                              {notificationTypeLabels[n.type] ?? n.type}
                              {' · '}
                              {notificationChannelLabels[n.channel] ?? n.channel}
                              {' · '}
                              {new Date(n.sent_at).toLocaleString('de-DE')}
                              {n.error && <span className="text-red-500"> · {n.error}</span>}
                              {n.provider_message_id && (
                                <span
                                  className="ml-1 font-mono text-[10px] text-smitten-text/30"
                                  title="Brevo-Message-ID. 'Zugestellt' heißt nur, dass Brevo die Mail angenommen hat — die tatsächliche Zustellung lässt sich damit bei Brevo prüfen."
                                >
                                  {n.provider_message_id}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : order.created_at.slice(0, 10) < NOTIFICATION_LINK_SINCE ? (
                        <p className="mt-1 text-xs text-smitten-text/40">
                          Keine Zuordnung möglich — bei Bestellungen vor dem 26.08.2026 wurde die
                          Benachrichtigung nicht mit der Bestellung verknüpft. Das heißt nicht, dass
                          nichts versendet wurde:{' '}
                          <Link href="/admin/notifications" className="underline">
                            in der Liste nachsehen
                          </Link>
                          .
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-smitten-text/40">
                          Für diese Bestellung wurde noch keine Benachrichtigung versendet.
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {order.discount_code && (
                        <p className="text-xs text-green-600">
                          Rabattcode {order.discount_code}: -{formatPrice(order.discount_cents || 0)}
                        </p>
                      )}
                      {order.status !== 'fulfilled' && order.status !== 'cancelled' && (
                        <>
                          <button
                            onClick={async () => {
                              if (!confirmTickOff(order, { allowUnpaid: false })) return;
                              if (confirm('Abholbenachrichtigung an ' + (order.customer_name || order.customer_email) + ' senden und Bestellung als abgeholt markieren?')) {
                                setSending(prev => ({ ...prev, [order.id]: true }));
                                const { data: { session } } = await supabase.auth.getSession();
                                const res = await fetch('/api/send-pickup-notification', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
                                  body: JSON.stringify({ order_id: order.id }),
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'fulfilled' as Order['status'] } : o));
                                } else {
                                  // Used to fail silently: the button just stopped
                                  // spinning and nothing said why.
                                  alert(data.error ?? 'Benachrichtigung konnte nicht gesendet werden.');
                                }
                                setSending(prev => ({ ...prev, [order.id]: false }));
                              }
                            }}
                            disabled={sending[order.id]}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {sending[order.id] ? 'Wird gesendet...' : 'Abholbenachrichtigung senden & abhaken'}
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirmTickOff(order, { allowUnpaid: true })) return;
                              if (confirm('Bestellung als abgeholt markieren (ohne Benachrichtigung)?')) {
                                const updated = await orderAction(order.id, 'mark_fulfilled', { allowUnpaid: true });
                                if (updated) {
                                  setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'fulfilled' as Order['status'] } : o));
                                }
                              }
                            }}
                            className="px-3 py-1.5 border border-smitten-cream text-smitten-text/60 text-xs rounded-lg hover:border-smitten-text/30 transition-colors"
                          >
                            Nur abhaken
                          </button>
                        </>
                      )}
                      {/* Deliberately outside the status gate above: an order can
                          be handed over (fulfilled) and still be unpaid — e.g. the
                          imported Squarespace history, or bread paid in cash. That
                          combination used to be unreachable, because every action
                          disappeared once the order was marked fulfilled. */}
                      {order.payment_status !== 'paid' && order.payment_status !== 'refunded' && (
                        <button
                          onClick={async () => {
                            if (confirm(
                              'Zahlung als erhalten markieren?\n\n' +
                              'Nur für Bestellungen, die außerhalb der App bezahlt wurden ' +
                              '(importierte Bestellungen, Barzahlung, Überweisung). ' +
                              'Eine Rechnungsnummer wird nur vergeben, falls noch keine existiert.'
                            )) {
                              const updated = await orderAction(order.id, 'mark_paid');
                              if (!updated) return;
                              // The numbering trigger may just have assigned
                              // order/invoice numbers — show them right away.
                              setOrders(prev => prev.map(o =>
                                o.id === order.id
                                  ? {
                                      ...o,
                                      payment_status: 'paid' as Order['payment_status'],
                                      order_number: (updated.order_number as string | null) ?? o.order_number,
                                      invoice_number: (updated.invoice_number as string | null) ?? o.invoice_number,
                                    }
                                  : o,
                              ));
                            }
                          }}
                          className="px-3 py-1.5 border border-smitten-cream text-smitten-text/60 text-xs rounded-lg hover:border-smitten-text/30 transition-colors"
                        >
                          Zahlung als erhalten markieren
                        </button>
                      )}
                    </div>
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
