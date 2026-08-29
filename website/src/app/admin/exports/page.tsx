'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { formatPrice } from '@/lib/types';

/**
 * All bookkeeping exports in one place — they lived on the Einstellungen
 * page, which had grown into a catch-all of eight unrelated concerns. The
 * export FUNCTIONS moved here verbatim; Einstellungen keeps configuration
 * (seller data, invoice mode, week cycle, e-mail test).
 */
export default function AdminExportsPage() {
  const [exportMsg, setExportMsg] = useState('');
  const [receiptDateFrom, setReceiptDateFrom] = useState('');
  const [receiptDateTo, setReceiptDateTo] = useState('');

  // Stripe fees state
  const [feeDateFrom, setFeeDateFrom] = useState('');
  const [feeDateTo, setFeeDateTo] = useState('');
  const [stripeFeeLoading, setStripeFeeLoading] = useState(false);
  const [stripeFeeSummary, setStripeFeeSummary] = useState<{
    days: number;
    transactions: number;
    total_gross_cents: number;
    total_fee_cents: number;
    total_net_cents: number;
  } | null>(null);
  const [stripeFeeError, setStripeFeeError] = useState('');

  // Credit notes state
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [creditNotesLoading, setCreditNotesLoading] = useState(false);

  async function exportInvoiceCsv() {
    setExportMsg('');

    const { data: orders } = await supabase
      .from('orders')
      .select('*, order_items(*), pickup_locations(name)')
      .order('fulfillment_date', { ascending: false })
      .limit(10000);

    if (!orders || orders.length === 0) {
      setExportMsg('Keine Bestellungen zum Exportieren vorhanden.');
      setTimeout(() => setExportMsg(''), 3000);
      return;
    }

    const rows = orders.map((order) => {
      const items = (order.order_items || []);
      const netTotal = Math.round(order.total_cents / 1.07);
      const vatTotal = order.total_cents - netTotal;
      return {
        invoice_number: order.invoice_number || '',
        customer_name: order.customer_name || '',
        customer_email: order.customer_email || '',
        fulfillment_date: order.fulfillment_date || '',
        total_gross_cents: order.total_cents,
        total_net_cents: netTotal,
        total_vat_cents: vatTotal,
        vat_rate: 0.07,
        payment_status: order.payment_status || '',
        items_count: items.length,
      };
    });

    downloadCsv(`rechnungsdaten-${new Date().toISOString().split('T')[0]}.csv`, buildCsv(rows));
  }

  async function exportCsv() {
    setExportMsg('');

    const { data: orders } = await supabase
      .from('orders')
      .select('*, order_items(*, products(name)), pickup_locations(name)')
      .order('fulfillment_date', { ascending: false })
      .limit(10000);

    if (!orders || orders.length === 0) {
      setExportMsg('Keine Bestellungen zum Exportieren vorhanden.');
      setTimeout(() => setExportMsg(''), 3000);
      return;
    }

    const rows = orders.map((order) => {
      const items = (order.order_items || [])
        .map((item: { products?: { name?: string }; quantity: number }) => {
          const name = item.products?.name || 'Unbekannt';
          return `${name} × ${item.quantity}`;
        })
        .join('; ');
      return {
        ID: order.id,
        Datum: order.fulfillment_date,
        Kunde: order.customer_name || order.customer_email || 'Gast',
        Typ: order.order_type === 'subscription' ? 'Abonnement' : 'Einmalig',
        Artikel: items,
        Summe_Cent: order.total_cents,
        Status: order.status,
        Zahlung: order.payment_status,
        Abholort: (order.pickup_locations as { name?: string })?.name || '',
      };
    });

    downloadCsv(`bestellungen-${new Date().toISOString().split('T')[0]}.csv`, buildCsv(rows));
  }

  async function exportStripeFees() {
    setStripeFeeError('');
    setStripeFeeSummary(null);
    if (!feeDateFrom) {
      setStripeFeeError('Bitte wähle ein Startdatum.');
      return;
    }

    setStripeFeeLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/export-stripe-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ from_date: feeDateFrom, to_date: feeDateTo || null }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setStripeFeeError(data.error || 'Export fehlgeschlagen');
        return;
      }

      downloadCsv(data.filename, data.csv);

      setStripeFeeSummary(data.summary);
    } catch (err: any) {
      setStripeFeeError(err.message || 'Export fehlgeschlagen');
    } finally {
      setStripeFeeLoading(false);
    }
  }

  async function exportDatevCsv() {
    setExportMsg('');
    if (!receiptDateFrom) {
      setExportMsg('Bitte wähle ein Startdatum.');
      setTimeout(() => setExportMsg(''), 4000);
      return;
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .gte('fulfillment_date', receiptDateFrom)
      .lte('fulfillment_date', receiptDateTo || '2099-12-31')
      .order('fulfillment_date', { ascending: true });

    if (!orders || orders.length === 0) {
      setExportMsg('Keine Bestellungen im gewählten Zeitraum.');
      setTimeout(() => setExportMsg(''), 3000);
      return;
    }

    const lines = [
      'Konto;Gegenkonto;BU-Schlüssel;Datum;Umsatz;Soll/Haben;Belegdatum;Belegfeld1;Buchungstext',
    ];

    // One query for every credit note in the range instead of one per order
    // inside the loop — the old N+1 made a year's export issue hundreds of
    // sequential requests.
    const { data: creditNotes } = await supabase
      .from('credit_notes')
      .select('*')
      .in('order_id', orders.map((o) => o.id));
    const creditNoteByOrder = new Map(
      (creditNotes ?? []).map((cn) => [cn.order_id as string, cn]),
    );

    for (const order of orders) {
      // Skip cancelled orders that have a credit note — the Storno handles the reversal
      const creditNote = creditNoteByOrder.get(order.id);

      if (creditNote) {
        // Storno reversal entry (negative booking)
        const date = (creditNote.created_at ? creditNote.created_at.substring(0, 10) : order.fulfillment_date).replace(/-/g, '');
        const netFmt = (creditNote.total_net_cents / 100).toFixed(2).replace('.', ',');
        const vatFmt = (creditNote.total_vat_cents / 100).toFixed(2).replace('.', ',');
        const invoiceNum = creditNote.credit_note_number;
        const customerName = (order.customer_name || 'Gast').replace(/\"/g, '""');

        // Reversal: revenue (8400) on Haben / VAT (1776) on Soll (opposite of original)
        lines.push([
          '8400', '', '1', date, netFmt, 'H', date, invoiceNum,
          `Storno ${invoiceNum} zu ${creditNote.original_invoice_number} ${customerName}`,
        ].join(';'));
        lines.push([
          '1776', '', '2', date, vatFmt, 'S', date, invoiceNum,
          `UST Storno 7% ${invoiceNum}`,
        ].join(';'));
        continue; // Skip the original invoice entry — the Storno replaces it
      }

      // Skip other cancelled orders (no credit note = cancelled before invoicing)
      if (order.status === 'cancelled' || order.status === 'refunded') continue;
      const date = order.fulfillment_date ? order.fulfillment_date.replace(/-/g, '') : '';
      const grossCents = order.total_cents;
      const netCents = Math.round(grossCents / 1.07);
      const vatCents = grossCents - netCents;
      const netFmt = (netCents / 100).toFixed(2).replace('.', ',');
      const vatFmt = (vatCents / 100).toFixed(2).replace('.', ',');
      const invoiceNum = order.invoice_number || order.id.substring(0, 8).toUpperCase();
      const customerName = (order.customer_name || 'Gast').replace(/"/g, '""');

      // Revenue line (net → Erlöskonto 8400, SKR 04)
      lines.push([
        '8400', '', '1', date, netFmt, 'S', date, invoiceNum,
        `Smittenbrot ${invoiceNum} ${customerName}`,
      ].join(';'));

      // VAT line (7% USt → Konto 1776, SKR 04)
      lines.push([
        '1776', '', '2', date, vatFmt, 'H', date, invoiceNum,
        `UST 7% ${invoiceNum}`,
      ].join(';'));
    }

    downloadCsv(`datev-${receiptDateFrom}-${receiptDateTo || 'bis'}.csv`, lines.join('\r\n'));
    setExportMsg(`${orders.length} Rechnungen als DATEV-Buchungsstapel exportiert.`);
    setTimeout(() => setExportMsg(''), 5000);
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Exporte</h1>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-smitten-cream p-5">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Datenexport
          </h2>
          <p className="text-sm text-smitten-text/60 mt-2">
            Alle Bestellungen als CSV-Datei exportieren (max. 10.000 Einträge).
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
            >
              Bestellungen exportieren (CSV)
            </button>
            <button
              onClick={exportInvoiceCsv}
              className="px-4 py-2 bg-smitten-accent text-white text-sm rounded-lg hover:bg-smitten-accent/90 transition-colors"
            >
              Rechnungsdaten exportieren (CSV)
            </button>
          </div>
          {exportMsg && (
            <p className="mt-3 text-sm text-smitten-text/60">{exportMsg}</p>
          )}
        </div>

        <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Rechnungen für DATEV
          </h2>
          <p className="text-sm text-smitten-text/60 mt-2">
            Wähle einen Zeitraum und exportiere die Rechnungen als DATEV-kompatiblen Buchungsstapel (CSV). Dieser kann direkt in DATEV Unternehmen Online importiert werden.
          </p>
          <div className="mt-4 flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Von</label>
              <input type="date" value={receiptDateFrom} onChange={e => setReceiptDateFrom(e.target.value)}
                className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Bis (optional)</label>
              <input type="date" value={receiptDateTo} onChange={e => setReceiptDateTo(e.target.value)}
                className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <button onClick={exportDatevCsv}
              className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors">
              DATEV-Buchungsstapel exportieren
            </button>
          </div>
          <p className="mt-3 text-xs text-smitten-text/40">
            Kontonummern: Erlöse 7% → 8400 (SKR04) | Umsatzsteuer 7% → 1776. Bitte vor dem Import mit deinem Steuerberater abstimmen.
          </p>
        </div>

        <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Stripe-Gebühren
          </h2>
          <p className="text-sm text-smitten-text/60 mt-2">
            Exportiere die von Stripe erhobenen Transaktionsgebühren als CSV. Enthält Bruttoumsatz, Gebühren und Nettobetrag pro Tag.
          </p>
          <div className="mt-4 flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Von</label>
              <input type="date" value={feeDateFrom} onChange={e => setFeeDateFrom(e.target.value)}
                className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Bis (optional)</label>
              <input type="date" value={feeDateTo} onChange={e => setFeeDateTo(e.target.value)}
                className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <button onClick={exportStripeFees} disabled={stripeFeeLoading}
              className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50">
              {stripeFeeLoading ? 'Lade...' : 'Stripe-Gebühren exportieren'}
            </button>
          </div>
          {stripeFeeSummary && (
            <div className="mt-3 p-3 bg-smitten-bg rounded-lg border border-smitten-cream text-sm">
              <p className="text-smitten-text font-medium">Exportiert</p>
              <p className="text-smitten-text/60 mt-1">
                {stripeFeeSummary.days} Tage · {stripeFeeSummary.transactions} Transaktionen
              </p>
              <p className="text-smitten-text/60">
                Brutto: {formatPrice(stripeFeeSummary.total_gross_cents)} ·
                Gebühren: {formatPrice(stripeFeeSummary.total_fee_cents)} ·
                Netto: {formatPrice(stripeFeeSummary.total_net_cents)}
              </p>
            </div>
          )}
          {stripeFeeError && (
            <p className="mt-3 text-sm text-red-500">{stripeFeeError}</p>
          )}
        </div>
      </div>

      {/* CREDIT NOTES / STORNO-RECHNUNGEN */}
      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Storno-Rechnungen (Gutschriften)
          </h2>
          <button
            onClick={async () => {
              setCreditNotesLoading(true);
              const { data } = await supabase
                .from('credit_notes')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
              if (data) setCreditNotes(data);
              setCreditNotesLoading(false);
            }}
            disabled={creditNotesLoading}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {creditNotesLoading ? 'Lade...' : 'Stornos laden'}
          </button>
        </div>
        <p className="text-sm text-smitten-text/60 mt-2">
          Übersicht aller ausgestellten Storno-Rechnungen. Wird automatisch erstellt, wenn eine bereits in Rechnung gestellte Bestellung storniert wird (§14 UStG).
        </p>
        {creditNotes.length > 0 && (
          <div className="mt-4 border border-smitten-cream rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-red-50 border-b border-smitten-cream">
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Storno-Nr.</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Original-Rechnung</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Datum</th>
                  <th className="text-right px-4 py-3 font-medium text-smitten-text">Betrag (brutto)</th>
                  <th className="text-left px-4 py-3 font-medium text-smitten-text">Grund</th>
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((cn: any) => (
                  <tr key={cn.id} className="border-b border-smitten-cream last:border-0 hover:bg-red-50/50">
                    <td className="px-4 py-3 font-mono text-sm text-red-600">{cn.credit_note_number}</td>
                    <td className="px-4 py-3 font-mono text-sm text-smitten-text">{cn.original_invoice_number}</td>
                    <td className="px-4 py-3 text-sm text-smitten-text">
                      {new Date(cn.created_at).toLocaleDateString('de-DE')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-red-600">
                      −{formatPrice(cn.total_gross_cents)}
                    </td>
                    <td className="px-4 py-3 text-sm text-smitten-text/70">{cn.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {creditNotes.length === 0 && !creditNotesLoading && (
          <p className="mt-3 text-sm text-smitten-text/40 italic">Bisher keine Storno-Rechnungen ausgestellt.</p>
        )}
      </div>
    </div>
  );
}
