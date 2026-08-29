'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product } from '@/lib/types';

interface WeekCycle {
  id: string;
  current_week: 'A' | 'B';
  switched_at: string;
}

interface SellerInfo {
  id: string;
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  country: string;
  tax_id: string;
  vat_id: string;
  email: string;
}

export default function AdminSettingsPage() {
  const [weekCycle, setWeekCycle] = useState<WeekCycle | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingCapacity, setEditingCapacity] = useState<Record<string, number>>({});
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [loading, setLoading] = useState(true);
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

  // Seller info state
  const [sellerInfo, setSellerInfo] = useState<SellerInfo | null>(null);
  const [sellerForm, setSellerForm] = useState({
    name: '',
    address_line1: '',
    address_line2: '',
    city: '',
    postal_code: '',
    tax_id: '',
    vat_id: '',
    email: '',
  });
  const [savingSeller, setSavingSeller] = useState(false);
  const [sellerSaved, setSellerSaved] = useState(false);
  const [sellerError, setSellerError] = useState('');

  // Invoice mode state
  const [invoiceMode, setInvoiceMode] = useState<'production' | 'test'>('production');
  const [togglingMode, setTogglingMode] = useState(false);

  // Test email state
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [weekRes, prodRes, sellerRes, settingsRes] = await Promise.all([
      supabase.from('week_cycle').select('*').limit(1).single(),
      supabase.from('products').select('*').order('sort_order', { ascending: true }),
      supabase.from('seller_info').select('*').limit(1).single(),
      supabase.from('system_settings').select('invoice_mode').limit(1).single(),
    ]);
    if (weekRes.data) setWeekCycle(weekRes.data);
    if (prodRes.data) {
      setProducts(prodRes.data);
      const capMap: Record<string, number> = {};
      for (const p of prodRes.data) capMap[p.id] = p.capacity;
      setEditingCapacity(capMap);
    }
    if (sellerRes.data) {
      setSellerInfo(sellerRes.data);
      setSellerForm({
        name: sellerRes.data.name || '',
        address_line1: sellerRes.data.address_line1 || '',
        address_line2: sellerRes.data.address_line2 || '',
        city: sellerRes.data.city || '',
        postal_code: sellerRes.data.postal_code || '',
        tax_id: sellerRes.data.tax_id || '',
        vat_id: sellerRes.data.vat_id || '',
        email: sellerRes.data.email || '',
      });
    }
    if (settingsRes.data) {
      setInvoiceMode(settingsRes.data.invoice_mode);
    }
    setLoading(false);
  }

  /**
   * Through /api/admin/system-actions: flipping the invoice numbering series
   * has bookkeeping consequences, so it is server-checked and audited there.
   */
  async function toggleInvoiceMode() {
    setTogglingMode(true);
    const newMode = invoiceMode === 'production' ? 'test' : 'production';
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/system-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ action: 'set_invoice_mode', invoice_mode: newMode }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      setInvoiceMode(newMode);
    } else {
      alert(data.error ?? 'Moduswechsel fehlgeschlagen.');
    }
    setTogglingMode(false);
  }

  async function sendTestEmail() {
    setTestEmailSending(true);
    setTestEmailResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/send-test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify(testEmailTo.trim() ? { to: testEmailTo.trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setTestEmailResult({
          ok: false,
          msg: (data.error || `Fehler (HTTP ${res.status}).`) + (data.detail ? ` — Brevo: ${data.detail}` : ''),
        });
      } else {
        setTestEmailResult({
          ok: true,
          msg: `Test-E-Mail an ${data.sentTo} gesendet. Prüfe den Posteingang (ggf. Spam-Ordner).`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Netzwerkfehler.';
      setTestEmailResult({ ok: false, msg });
    } finally {
      setTestEmailSending(false);
    }
  }

  async function saveSellerInfo() {
    setSavingSeller(true);
    setSellerSaved(false);
    setSellerError('');
    // This used to set "Gespeichert" unconditionally — an RLS rejection or a
    // network failure showed the green success message anyway.
    const { error } = sellerInfo?.id
      ? await supabase
          .from('seller_info')
          .update({ ...sellerForm, updated_at: new Date().toISOString() })
          .eq('id', sellerInfo.id)
      : await supabase.from('seller_info').insert(sellerForm);
    setSavingSeller(false);
    if (error) {
      setSellerError(`Speichern fehlgeschlagen: ${error.message}`);
      return;
    }
    setSellerSaved(true);
    setTimeout(() => setSellerSaved(false), 3000);
  }

  /**
   * Through the same week-cycle-switch function the cron uses (via
   * /api/admin/system-actions), so a manual switch shows up in the audit log
   * and cannot drift from the function's semantics. The old direct table
   * write did neither.
   */
  async function switchWeek() {
    if (!weekCycle) return;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/system-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ action: 'switch_week' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) loadData();
    else alert(data.error ?? 'Wochenwechsel fehlgeschlagen.');
  }

  async function saveCapacities() {
    setSavingCapacity(true);
    const updates = products.map((p) => {
      if (editingCapacity[p.id] !== p.capacity) {
        return supabase
          .from('products')
          .update({ capacity: editingCapacity[p.id] })
          .eq('id', p.id);
      }
      return Promise.resolve();
    });
    await Promise.all(updates);
    setSavingCapacity(false);
    loadData();
  }

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

    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const val = (row as Record<string, unknown>)[h];
            const str = String(val ?? '');
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(','),
      ),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rechnungsdaten-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const val = (row as Record<string, unknown>)[h];
            const str = String(val ?? '');
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(','),
      ),
    ].join('\n');

    // BOM like the other exports — without it Excel mangles the umlauts.
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bestellungen-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

      // Trigger CSV download
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);

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

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datev-${receiptDateFrom}-${receiptDateTo || 'bis'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMsg(`${orders.length} Rechnungen als DATEV-Buchungsstapel exportiert.`);
    setTimeout(() => setExportMsg(''), 5000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Einstellungen...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Einstellungen</h1>

      {/* SELLER INFO */}
      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Verkäuferinformationen
          </h2>
          <button
            onClick={saveSellerInfo}
            disabled={savingSeller}
            className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
          >
            {savingSeller ? 'Speichere...' : 'Speichern'}
          </button>
        </div>
        {sellerError && (
          <p className="mt-3 text-sm text-red-600">{sellerError}</p>
        )}
        {sellerSaved && (
          <p className="mt-2 text-sm text-green-600">Verkäuferinformationen gespeichert.</p>
        )}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Name (Firma)</label>
            <input
              type="text"
              value={sellerForm.name}
              onChange={(e) => setSellerForm({ ...sellerForm, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
            <input
              type="email"
              value={sellerForm.email}
              onChange={(e) => setSellerForm({ ...sellerForm, email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Adresszeile 1</label>
            <input
              type="text"
              value={sellerForm.address_line1}
              onChange={(e) => setSellerForm({ ...sellerForm, address_line1: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Adresszeile 2 (optional)</label>
            <input
              type="text"
              value={sellerForm.address_line2}
              onChange={(e) => setSellerForm({ ...sellerForm, address_line2: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">PLZ</label>
            <input
              type="text"
              value={sellerForm.postal_code}
              onChange={(e) => setSellerForm({ ...sellerForm, postal_code: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Stadt</label>
            <input
              type="text"
              value={sellerForm.city}
              onChange={(e) => setSellerForm({ ...sellerForm, city: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Steuernummer</label>
            <input
              type="text"
              value={sellerForm.tax_id}
              onChange={(e) => setSellerForm({ ...sellerForm, tax_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Umsatzsteuer-ID (optional)</label>
            <input
              type="text"
              value={sellerForm.vat_id}
              onChange={(e) => setSellerForm({ ...sellerForm, vat_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
            />
          </div>
        </div>
      </div>

      {/* INVOICE MODE TOGGLE */}
      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Rechnungsmodus
          </h2>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              invoiceMode === 'production'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {invoiceMode === 'production' ? 'Produktion' : 'Test'}
          </span>
        </div>
        <p className="mt-2 text-sm text-smitten-text/60">
          {invoiceMode === 'production'
            ? 'Bestellungen erhalten Produktions-Rechnungsnummern (RE-00124 ff.)'
            : 'Bestellungen erhalten Test-Rechnungsnummern (TEST-RE-00001 ff.) — keine Auswirkung auf Produktionsnummern'}
        </p>
        {invoiceMode === 'test' && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800 font-medium">
              ⚠️ Testmodus aktiv — alle neuen Bestellungen bekommen TEST-Rechnungsnummern. Vor Produktionswechsel sicherstellen, dass alle Testbestellungen storniert wurden.
            </p>
          </div>
        )}
        <div className="mt-4">
          <button
            onClick={toggleInvoiceMode}
            disabled={togglingMode}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              invoiceMode === 'production'
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {togglingMode
              ? 'Wechsle...'
              : invoiceMode === 'production'
              ? 'Zu Testmodus wechseln'
              : 'Zu Produktionsmodus wechseln'}
          </button>
        </div>
      </div>

      {/* EMAIL TEST */}
      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <h2 className="font-display font-bold text-smitten-text text-lg">E-Mail-Test</h2>
        <p className="mt-2 text-sm text-smitten-text/60">
          Sende eine Test-E-Mail über Brevo, um den E-Mail-Versand zu prüfen — ohne eine echte Bestellung auszulösen. Ohne Empfänger wird an die Admin-Adresse gesendet.
        </p>
        <div className="mt-4 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">Empfänger (optional)</label>
            <input
              type="email"
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="name@beispiel.de"
              className="rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white w-64 max-w-full"
            />
          </div>
          <button
            onClick={sendTestEmail}
            disabled={testEmailSending}
            className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
          >
            {testEmailSending ? 'Sende...' : 'Test-E-Mail senden'}
          </button>
        </div>
        {testEmailResult && (
          <p className={`mt-3 text-sm ${testEmailResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testEmailResult.msg}
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-smitten-cream p-5">
          <h2 className="font-display font-bold text-smitten-text text-lg">Wochenzyklus</h2>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-smitten-text/60">Aktuelle Woche</p>
              <p className="text-3xl font-display font-bold text-smitten-text mt-1">
                {weekCycle?.current_week || '–'}
              </p>
              {weekCycle?.switched_at && (
                <p className="text-xs text-smitten-text/40 mt-1">
                  Zuletzt gewechselt:{' '}
                  {new Date(weekCycle.switched_at).toLocaleString('de-DE')}
                </p>
              )}
            </div>
            <button
              onClick={switchWeek}
              className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
            >
              Zu Woche {weekCycle?.current_week === 'A' ? 'B' : 'A'} wechseln
            </button>
          </div>
        </div>

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
                Brutto: €{(stripeFeeSummary.total_gross_cents / 100).toFixed(2).replace('.', ',')} ·
                Gebühren: €{(stripeFeeSummary.total_fee_cents / 100).toFixed(2).replace('.', ',')} ·
                Netto: €{(stripeFeeSummary.total_net_cents / 100).toFixed(2).replace('.', ',')}
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
                      −{(cn.total_gross_cents / 100).toFixed(2).replace('.', ',')} €
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

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-smitten-text text-lg">
            Kapazitätsübersicht
          </h2>
          <button
            onClick={saveCapacities}
            disabled={savingCapacity}
            className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
          >
            {savingCapacity ? 'Speichere...' : 'Änderungen speichern'}
          </button>
        </div>

        <div className="mt-4 border border-smitten-cream rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-smitten-cream/50 border-b border-smitten-cream">
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Produkt</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Zyklus</th>
                <th className="text-right px-4 py-3 font-medium text-smitten-text">Kapazität</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-smitten-cream last:border-0">
                  <td className="px-4 py-3 text-smitten-text">{product.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-smitten-bg text-smitten-text/60">
                      {product.cycle === 'permanent'
                        ? 'Immer'
                        : product.cycle === 'week_a'
                        ? 'Woche A'
                        : product.cycle === 'week_b'
                        ? 'Woche B'
                        : 'Versteckt'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      value={editingCapacity[product.id] ?? product.capacity}
                      onChange={(e) =>
                        setEditingCapacity((prev) => ({
                          ...prev,
                          [product.id]: Number(e.target.value),
                        }))
                      }
                      min={0}
                      className="w-20 px-2 py-1 text-right rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-5">
        <h2 className="font-display font-bold text-smitten-text text-lg">Zeitzone</h2>
        <p className="text-sm text-smitten-text/60 mt-2">
          Alle betrieblichen Zeitpläne verwenden die folgende Zeitzone:
        </p>
        <div className="mt-3">
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-smitten-bg rounded-lg border border-smitten-cream text-sm font-medium text-smitten-text">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Europe/Berlin
          </span>
          <p className="text-xs text-smitten-text/40 mt-2">
            Diese Einstellung ist fest konfiguriert und kann nicht geändert werden.
          </p>
        </div>
      </div>
    </div>
  );
}
