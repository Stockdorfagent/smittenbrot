'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminLoading } from '@/components/admin/AdminLoading';

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
  const [loading, setLoading] = useState(true);

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
    const [weekRes, sellerRes, settingsRes] = await Promise.all([
      supabase.from('week_cycle').select('*').limit(1).single(),
      supabase.from('seller_info').select('*').limit(1).single(),
      supabase.from('system_settings').select('invoice_mode').limit(1).single(),
    ]);
    if (weekRes.data) setWeekCycle(weekRes.data);
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

  if (loading) return <AdminLoading what="Einstellungen" />;

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

      <div className="mt-6 max-w-2xl">
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
