'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatPrice } from '@/lib/types';

interface SellerInfo {
  name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string;
  country: string;
  tax_id: string;
  vat_id: string | null;
  email: string;
}

interface OrderInvoice {
  id: string;
  invoice_number: string | null;
  created_at: string;
  fulfillment_date: string;
  status: string;
  payment_status: string;
  total_cents: number;
  net_total_cents: number;
  vat_total_cents: number;
  customer_name: string | null;
  customer_email: string | null;
}

interface CreditNote {
  id: string;
  credit_note_number: string;
  original_invoice_number: string;
  total_gross_cents: number;
  total_net_cents: number;
  total_vat_cents: number;
  vat_rate: number;
  reason: string;
  created_at: string;
}

interface InvoiceItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  unit_price_gross_cents: number;
  unit_price_net_cents: number;
  vat_cents: number;
  vat_rate: number;
  product_name?: string;
}

const paymentStatusLabels: Record<string, string> = {
  pending: 'Ausstehend',
  paid: 'Bezahlt',
  failed: 'Fehlgeschlagen',
  refunded: 'Rückerstattet',
};

const statusLabels: Record<string, string> = {
  scheduled: 'Geplant',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderungsfenster',
  locked_for_production: 'Für Produktion gesperrt',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderInvoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [sellerInfo, setSellerInfo] = useState<SellerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [canCancel, setCanCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelSuccess, setCancelSuccess] = useState(false);
  const [creditNote, setCreditNote] = useState<CreditNote | null>(null);

  useEffect(() => {
    async function fetchInvoice() {
      // Try authenticated first, fall back to any session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }

      const { data: orderData } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();

      if (!orderData) {
        router.push('/orders');
        return;
      }

      setOrder(orderData);

      // Check if order can still be cancelled (before cutoff)
      if (orderData.payment_status === 'paid' && 
          orderData.status !== 'cancelled' && 
          orderData.status !== 'refunded' &&
          orderData.status !== 'fulfilled') {
        const now = new Date();
        const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
        const cutDate = new Date(orderData.fulfillment_date + 'T14:00:00+02:00');
        if (berlin < cutDate) {
          setCanCancel(true);
        }
      }

      // Fetch order items with product names
      const { data: itemsData } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsData) {
        const itemsWithNames = await Promise.all(
          itemsData.map(async (item) => {
            const { data: product } = await supabase
              .from('products')
              .select('name')
              .eq('id', item.product_id)
              .single();
            return {
              ...item,
              product_name: product?.name || 'Unbekanntes Produkt',
            };
          })
        );
        setItems(itemsWithNames);
      }

      // Fetch seller info
      const { data: sellerData } = await supabase
        .from('seller_info')
        .select('*')
        .limit(1)
        .single();

      if (sellerData) {
        setSellerInfo(sellerData);
      }

      // Fetch credit note if order is cancelled (Storno-Rechnung)
      if (orderData.status === 'cancelled' || orderData.status === 'refunded') {
        const { data: cnData } = await supabase
          .from('credit_notes')
          .select('*')
          .eq('order_id', id)
          .maybeSingle();
        if (cnData) setCreditNote(cnData);
      }

      setLoading(false);
    }
    fetchInvoice();
  }, [id]);

  async function handleCancelOrder() {
    if (!confirm('Möchtest du die gesamte Bestellung stornieren? Der Betrag wird zurückerstattet.')) return;
    setCancelling(true);
    setCancelError('');
    setCancelSuccess(false);

    try {
      const res = await fetch('/api/refund-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCancelError(data.error || 'Fehler bei der Stornierung');
        setCancelling(false);
        return;
      }
      setCancelSuccess(true);
      setCanCancel(false);
    } catch {
      setCancelError('Verbindungsfehler');
    }
    setCancelling(false);
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center text-smitten-text/40">
        Wird geladen...
      </div>
    );
  }

  if (!order || !sellerInfo) return null;

  // Calculate using same formula as cart (gross includes 7% VAT)
  const netTotal = Math.round(order.total_cents / 1.07);
  const vatTotal = order.total_cents - netTotal;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Print button — visible only on screen */}
      <div className="no-print flex items-center justify-between mb-6">
        <button
          onClick={() => router.push('/orders')}
          className="text-sm text-smitten-secondary hover:underline"
        >
          ← Alle Bestellungen
        </button>
        <button
          onClick={() => window.print()}
          className="px-5 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors print:hidden"
        >
          Drucken
        </button>
      </div>

      {/* Receipt / Rechnung */}
      <div className="bg-white rounded-xl border border-smitten-cream p-8 md:p-10 print:border-0 print:shadow-none print:p-0">
        {/* HEADER: Rechnung */}
        <div className="text-center border-b border-gray-200 pb-6 mb-6 print:pb-4 print:mb-4">
          <h1 className="text-3xl font-display font-bold text-smitten-text">
            Rechnung
          </h1>
          <p className="mt-1 text-lg font-mono text-smitten-secondary">
            {order.invoice_number || 'RE-' + order.id.slice(0, 8).toUpperCase()}
          </p>
        </div>

        {/* SELLER & CUSTOMER INFO */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 print:gap-4 print:mb-6">
          {/* Seller */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-smitten-text/50 mb-2">
              Verkäufer
            </h3>
            <div className="text-sm text-smitten-text space-y-0.5">
              <p className="font-medium text-smitten-text">{sellerInfo.name}</p>
              <p>{sellerInfo.address_line1}</p>
              {sellerInfo.address_line2 && <p>{sellerInfo.address_line2}</p>}
              <p>{sellerInfo.postal_code} {sellerInfo.city}</p>
              <p className="mt-2">Steuernummer: {sellerInfo.tax_id || '—'}</p>
              {sellerInfo.vat_id && <p>USt-ID: {sellerInfo.vat_id}</p>}
              <p className="mt-1">{sellerInfo.email}</p>
            </div>
          </div>
          {/* Customer */}
          <div className="md:text-right">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-smitten-text/50 mb-2">
              Kunde
            </h3>
            <div className="text-sm text-smitten-text space-y-0.5">
              <p className="font-medium text-smitten-text">
                {order.customer_name || 'Gast'}
              </p>
              <p>{order.customer_email || '—'}</p>
            </div>
          </div>
        </div>

        {/* ITEMS TABLE */}
        <table className="w-full text-sm mb-8 print:mb-6">
          <thead>
            <tr className="border-b border-gray-300 text-xs text-smitten-text/60 uppercase tracking-wider">
              <th className="text-left pb-2 pr-2">Pos.</th>
              <th className="text-left pb-2 pr-2">Produkt</th>
              <th className="text-right pb-2 pr-2">Menge</th>
              <th className="text-right pb-2 pr-2">Preis/Stück (brutto)</th>
              <th className="text-right pb-2 pr-2">Netto</th>
              <th className="text-right pb-2 pr-2">MwSt.</th>
              <th className="text-right pb-2">Gesamt (brutto)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const grossUnit = item.unit_price_gross_cents || item.unit_price_cents;
              const netUnit = item.unit_price_net_cents || Math.round(grossUnit / 1.07);
              const vatUnit = item.vat_cents || (grossUnit - netUnit);
              const lineGross = grossUnit * item.quantity;
              return (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-2 pr-2 text-smitten-text/60">{idx + 1}</td>
                  <td className="py-2 pr-2 font-medium text-smitten-text">
                    {item.product_name}
                  </td>
                  <td className="py-2 pr-2 text-right text-smitten-text">
                    {item.quantity}
                  </td>
                  <td className="py-2 pr-2 text-right text-smitten-text">
                    {formatPrice(grossUnit)}
                  </td>
                  <td className="py-2 pr-2 text-right text-smitten-text">
                    {formatPrice(netUnit)}
                  </td>
                  <td className="py-2 pr-2 text-right text-smitten-text">
                    {formatPrice(vatUnit)}
                  </td>
                  <td className="py-2 text-right font-medium text-smitten-text">
                    {formatPrice(lineGross)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* SUMMARY */}
        <div className="border-t border-gray-300 pt-4 mb-8 print:mb-6">
          <div className="max-w-xs ml-auto space-y-1 text-sm">
            <div className="flex justify-between text-smitten-text/70">
              <span>Zwischensumme (netto)</span>
              <span>{formatPrice(netTotal)}</span>
            </div>
            <div className="flex justify-between text-smitten-text/70">
              <span>MwSt. 7%</span>
              <span>{formatPrice(vatTotal)}</span>
            </div>
            {(order as any).discount_code && (
            <div className="flex justify-between text-green-600 text-sm">
              <span>Rabatt ({(order as any).discount_code})</span>
              <span>-{formatPrice((order as any).discount_cents || 0)}</span>
            </div>
            )}
            <div className="flex justify-between font-bold text-base text-smitten-text pt-2 border-t border-gray-200">
              <span>Gesamtsumme (brutto)</span>
              <span className="text-smitten-accent">{formatPrice(order.total_cents)}</span>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-200 pt-4 text-xs text-smitten-text/50 space-y-1 print:pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Rechnungsdatum:{' '}
              <strong className="text-smitten-text/70">
                {new Date(order.created_at).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </strong>
            </span>
            <span>
              Leistungsdatum:{' '}
              <strong className="text-smitten-text/70">
                {new Date(order.fulfillment_date).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </strong>
            </span>
            <span>
              Zahlungsstatus:{' '}
              <strong className="text-smitten-text/70">
                {paymentStatusLabels[order.payment_status] || order.payment_status}
              </strong>
            </span>
            <span>
              Bestellstatus:{' '}
              <strong className="text-smitten-text/70">
                {statusLabels[order.status] || order.status}
              </strong>
            </span>
          </div>
          <p className="mt-2 text-xs text-smitten-text/40">
            Gemäß § 14 UStG. Bei 7% MwSt. gemäß § 12 Abs. 2 UStG (ermäßigter Steuersatz).
          </p>
        </div>

        {/* Cancel / Refund button */}
        {canCancel && (
          <div className="mt-8 no-print">
            <button
              onClick={handleCancelOrder}
              disabled={cancelling}
              className="w-full border border-red-300 text-red-600 py-3 rounded-full font-medium text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {cancelling ? 'Wird storniert...' : 'Gesamte Bestellung stornieren & Rückerstattung'}
            </button>
            <p className="mt-2 text-xs text-center text-smitten-text/40">
              Rückerstattung erfolgt auf das ursprüngliche Zahlungsmittel. Nur möglich vor Bestellschluss.
            </p>
          </div>
        )}
        {cancelError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{cancelError}</div>
        )}
        {cancelSuccess && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            Bestellung wurde storniert und der Betrag zurückerstattet.
          </div>
        )}

        {/* Storno-Rechnung (Gutschrift) — shown when order is cancelled with a credit note */}
        {creditNote && (
          <div className="mt-8 bg-white rounded-xl border-2 border-red-200 p-8 md:p-10 print:border-0 print:shadow-none print:p-0">
            <div className="text-center border-b border-gray-200 pb-6 mb-6 print:pb-4 print:mb-4">
              <h2 className="text-3xl font-display font-bold text-red-600">
                Storno-Rechnung
              </h2>
              <p className="mt-1 text-lg font-mono text-smitten-secondary">
                {creditNote.credit_note_number}
              </p>
              <p className="mt-1 text-sm text-smitten-text/50">
                zu Original-Rechnung <strong>{creditNote.original_invoice_number}</strong>
              </p>
            </div>

            {/* SELLER & CUSTOMER — same data as original */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 print:gap-4 print:mb-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-smitten-text/50 mb-2">Verkäufer</h3>
                <div className="text-sm text-smitten-text space-y-0.5">
                  <p className="font-medium text-smitten-text">{sellerInfo.name}</p>
                  <p>{sellerInfo.address_line1}</p>
                  {sellerInfo.address_line2 && <p>{sellerInfo.address_line2}</p>}
                  <p>{sellerInfo.postal_code} {sellerInfo.city}</p>
                  <p className="mt-2">Steuernummer: {sellerInfo.tax_id || '—'}</p>
                  {sellerInfo.vat_id && <p>USt-ID: {sellerInfo.vat_id}</p>}
                </div>
              </div>
              <div className="md:text-right">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-smitten-text/50 mb-2">Kunde</h3>
                <div className="text-sm text-smitten-text space-y-0.5">
                  <p className="font-medium">{order.customer_name || 'Gast'}</p>
                  <p>{order.customer_email || '—'}</p>
                </div>
              </div>
            </div>

            {/* Items with negative amounts */}
            <table className="w-full text-sm mb-8 print:mb-6">
              <thead>
                <tr className="border-b border-gray-300 text-xs text-smitten-text/60 uppercase tracking-wider">
                  <th className="text-left pb-2 pr-2">Pos.</th>
                  <th className="text-left pb-2 pr-2">Produkt</th>
                  <th className="text-right pb-2 pr-2">Menge</th>
                  <th className="text-right pb-2 pr-2">Preis/Stück (brutto)</th>
                  <th className="text-right pb-2 pr-2">Netto</th>
                  <th className="text-right pb-2 pr-2">MwSt.</th>
                  <th className="text-right pb-2">Gesamt (brutto)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const grossUnit = item.unit_price_gross_cents || item.unit_price_cents;
                  const netUnit = item.unit_price_net_cents || Math.round(grossUnit / 1.07);
                  const vatUnit = item.vat_cents || (grossUnit - netUnit);
                  const lineGross = -(grossUnit * item.quantity);
                  return (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="py-2 pr-2 text-smitten-text/60">{idx + 1}</td>
                      <td className="py-2 pr-2 font-medium text-smitten-text">{item.product_name}</td>
                      <td className="py-2 pr-2 text-right text-smitten-text">{item.quantity}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{formatPrice(grossUnit)}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{formatPrice(netUnit)}</td>
                      <td className="py-2 pr-2 text-right text-red-600">{formatPrice(vatUnit)}</td>
                      <td className="py-2 text-right font-medium text-red-600">{formatPrice(lineGross)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Summary with negative amounts */}
            <div className="border-t border-gray-300 pt-4 mb-8 print:mb-6">
              <div className="max-w-xs ml-auto space-y-1 text-sm">
                <div className="flex justify-between text-red-600">
                  <span>Zwischensumme (netto)</span>
                  <span>&minus;{formatPrice(creditNote.total_net_cents)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>MwSt. 7%</span>
                  <span>&minus;{formatPrice(creditNote.total_vat_cents)}</span>
                </div>
                <div className="flex justify-between font-bold text-base text-red-600 pt-2 border-t border-gray-200">
                  <span>Gesamtsumme (brutto)</span>
                  <span>&minus;{formatPrice(creditNote.total_gross_cents)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 text-xs text-smitten-text/50 space-y-1 print:pt-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  Gutschrift vom:{' '}
                  <strong className="text-smitten-text/70">
                    {new Date(creditNote.created_at).toLocaleDateString('de-DE', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                    })}
                  </strong>
                </span>
                <span>
                  Grund: <strong className="text-smitten-text/70">{creditNote.reason}</strong>
                </span>
              </div>
              <p className="mt-2 text-xs text-smitten-text/40">
                Stornorechnung gemäß §14 UStG. Diese Gutschrift hebt die ursprüngliche Rechnung {creditNote.original_invoice_number} auf.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 20mm;
          }
        }
      `}</style>
    </div>
  );
}
