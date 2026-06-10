'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Discount {
  id: string;
  code: string;
  description: string | null;
  type: 'percentage' | 'fixed';
  value: number;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  usage_count?: number;
}

const typeLabels: Record<string, string> = {
  percentage: 'Prozent',
  fixed: 'Fixbetrag',
};

function formatCents(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const emptyForm = {
  code: '',
  description: '',
  type: 'percentage' as 'percentage' | 'fixed',
  value: 0,
  max_uses: '' as string | number,
  max_uses_per_customer: '' as string | number,
  expires_at: '',
  active: true,
};

export default function AdminDiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDiscounts();
  }, []);

  async function loadDiscounts() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch usage counts directly from discount_usage
      const discountIds = (data || []).map(d => d.id);
      const usageMap: Record<string, number> = {};
      if (discountIds.length > 0) {
        const { data: usageData } = await supabase
          .from('discount_usage')
          .select('discount_id')
          .in('discount_id', discountIds);
        for (const u of usageData || []) {
          usageMap[u.discount_id] = (usageMap[u.discount_id] || 0) + 1;
        }
      }

      setDiscounts((data || []).map(d => ({ ...d, usage_count: usageMap[d.id] || 0 })));
    } catch (err) {
      console.error('Error loading discounts:', err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ ...emptyForm });
    setShowForm(false);
    setError('');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Nicht angemeldet.');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          code: form.code,
          description: form.description || undefined,
          type: form.type,
          value: form.value,
          max_uses: form.max_uses !== '' ? Number(form.max_uses) : null,
          max_uses_per_customer: form.max_uses_per_customer !== '' ? Number(form.max_uses_per_customer) : null,
          expires_at: form.expires_at || null,
          active: form.active,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Erstellen');
      }

      resetForm();
      loadDiscounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Rabattcodes...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Rabattcodes</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-full hover:bg-smitten-primary/90 transition-colors"
        >
          + Neuen Rabattcode
        </button>
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-20">
          <div className="bg-white rounded-xl border border-smitten-cream w-full max-w-lg p-6 mx-4 shadow-lg">
            <h2 className="text-lg font-display font-bold text-smitten-text">Neuen Rabattcode erstellen</h2>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Code *</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    placeholder="SOMMER25"
                  />
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Typ *</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as 'percentage' | 'fixed' })}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  >
                    <option value="percentage">Prozent (%)</option>
                    <option value="fixed">Fixbetrag (€)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">
                    Wert * {form.type === 'percentage' ? '(%)' : '(Cent)'}
                  </label>
                  <input
                    type="number"
                    value={form.value}
                    onChange={e => setForm({ ...form, value: Number(e.target.value) })}
                    required
                    min="1"
                    max={form.type === 'percentage' ? 100 : undefined}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Max. Nutzungen</label>
                  <input
                    type="number"
                    value={form.max_uses}
                    onChange={e => setForm({ ...form, max_uses: e.target.value })}
                    min="1"
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    placeholder="Unbegrenzt"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Pro Kunde max.</label>
                  <input
                    type="number"
                    value={form.max_uses_per_customer}
                    onChange={e => setForm({ ...form, max_uses_per_customer: e.target.value })}
                    min="1"
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    placeholder="Unbegrenzt"
                  />
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Gültig bis</label>
                  <input
                    type="date"
                    value={form.expires_at}
                    onChange={e => setForm({ ...form, expires_at: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-smitten-text/60 mb-1">Beschreibung</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  placeholder="z. B. 50% Rabatt zur Begrüßung"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-smitten-text">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm({ ...form, active: e.target.checked })}
                  className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
                />
                Aktiv (sofort verfügbar)
              </label>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Wird erstellt...' : 'Erstellen'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-smitten-cream text-sm rounded-lg text-smitten-text/60 hover:bg-smitten-bg transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discounts table */}
      <div className="mt-6 bg-white rounded-xl border border-smitten-cream overflow-hidden">
        {discounts.length === 0 ? (
          <div className="p-8 text-center text-smitten-text/60 text-sm">
            Keine Rabattcodes vorhanden. Erstelle den ersten!
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-smitten-cream bg-smitten-cream/50">
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Code</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Beschreibung</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Typ</th>
                <th className="text-right px-4 py-3 font-medium text-smitten-text">Wert</th>
                <th className="text-right px-4 py-3 font-medium text-smitten-text">Nutzungen</th>
                <th className="text-center px-4 py-3 font-medium text-smitten-text">Max.</th>
                <th className="text-left px-4 py-3 font-medium text-smitten-text">Gültig bis</th>
                <th className="text-center px-4 py-3 font-medium text-smitten-text">Status</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => {
                const isExpired = d.expires_at && new Date(d.expires_at) < new Date();
                return (
                  <tr key={d.id} className="border-b border-smitten-cream last:border-0 hover:bg-smitten-cream/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-smitten-text">{d.code}</td>
                    <td className="px-4 py-3 text-smitten-text/60 max-w-[200px] truncate">
                      {d.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-smitten-text/70">{typeLabels[d.type] || d.type}</td>
                    <td className="px-4 py-3 text-right font-medium text-smitten-text">
                      {d.type === 'percentage' ? `${d.value}%` : formatCents(d.value)}
                    </td>
                    <td className="px-4 py-3 text-right text-smitten-text">
                      {(d.usage_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-smitten-text/60">
                      {d.max_uses ?? '∞'}
                    </td>
                    <td className="px-4 py-3 text-smitten-text/60">
                      {formatDate(d.expires_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        !d.active
                          ? 'bg-gray-100 text-gray-500'
                          : isExpired
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-green-100 text-green-700'
                      }`}>
                        {!d.active ? 'Inaktiv' : isExpired ? 'Abgelaufen' : 'Aktiv'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
