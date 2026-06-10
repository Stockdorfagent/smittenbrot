'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';

const cycleLabels: Record<string, string> = {
  permanent: 'Immer',
  week_a: 'Woche A',
  week_b: 'Woche B',
  hidden: 'Versteckt',
};

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [warning, setWarning] = useState<string | null>(null);
  const [warningAction, setWarningAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true });
    if (data) setProducts(data);
    setLoading(false);
  }

  function startEdit(product: Product) {
    setEditingId(product.id);
    setEditForm({ ...product });
    setWarning(null);
    setWarningAction(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setWarning(null);
    setWarningAction(null);
  }

  async function checkCapacityWarning(productId: string, newCapacity: number) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production']);

    if (!orders || orders.length === 0) return true;

    const orderIds = orders.map((o) => o.id);
    const { data: items } = await supabase
      .from('order_items')
      .select('quantity')
      .eq('product_id', productId)
      .in('order_id', orderIds);

    const totalOrdered = (items || []).reduce((sum, i) => sum + i.quantity, 0);
    if (totalOrdered > newCapacity) {
      setWarning(
        `Dieses Produkt ist bereits ${totalOrdered}x in offenen Bestellungen. Die neue Kapazität (${newCapacity}) ist niedriger. Trotzdem speichern?`,
      );
      return false;
    }
    return true;
  }

  async function checkDisableWarning(productId: string) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production']);

    if (!orders || orders.length === 0) return true;

    const orderIds = orders.map((o) => o.id);
    const { data: items } = await supabase
      .from('order_items')
      .select('order_id')
      .eq('product_id', productId)
      .in('order_id', orderIds);

    const affectedOrders = new Set((items || []).map((i) => i.order_id));

    if (affectedOrders.size > 0) {
      setWarning(
        `Achtung: Dieses Produkt befindet sich in ${affectedOrders.size} offenen Bestellungen.`,
      );
      return false;
    }
    return true;
  }

  async function saveEdit() {
    if (!editingId || !editForm) return;

    if (editForm.capacity !== undefined) {
      const ok = await checkCapacityWarning(editingId, editForm.capacity);
      if (!ok) {
        setWarningAction(() => async () => {
          await performSave();
        });
        return;
      }
    }

    await performSave();
  }

  async function performSave() {
    if (!editingId || !editForm) return;
    const { error } = await supabase
      .from('products')
      .update({
        name: editForm.name,
        description: editForm.description,
        price_cents: editForm.price_cents,
        capacity: editForm.capacity,
        cycle: editForm.cycle,
        available_wed: editForm.available_wed,
        available_sat: editForm.available_sat,
        active: editForm.active,
      })
      .eq('id', editingId);

    if (!error) {
      setEditingId(null);
      setEditForm({});
      setWarning(null);
      setWarningAction(null);
      loadProducts();
    }
  }

  async function handleDisable(productId: string, disableAll: boolean) {
    const updates: Partial<Product> = { active: false };
    if (!disableAll) {
      // future only: keep active but mark as hidden cycle
      updates.cycle = 'hidden';
    }

    const { error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', productId);

    if (!error) {
      setWarning(null);
      setWarningAction(null);
      loadProducts();
    }
  }

  async function emergencyDisable(product: Product) {
    const ok = await checkDisableWarning(product.id);
    if (!ok) {
      setWarningAction(() => (mode: string) => {
        if (mode === 'future') {
          handleDisable(product.id, false);
        } else if (mode === 'all') {
          handleDisable(product.id, true);
        }
      });
      return;
    }
    await handleDisable(product.id, true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Produkte...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-display font-bold text-smitten-text">Produkte</h1>

      {warning && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800">{warning}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                if (warningAction) {
                  if (editingId) (warningAction as () => Promise<void>)();
                  else (warningAction as (mode: string) => void)('all');
                }
                setWarning(null);
                setWarningAction(null);
              }}
              className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700 transition-colors"
            >
              Trotzdem speichern
            </button>
            {!editingId && (
              <button
                onClick={() => {
                  if (warningAction) (warningAction as (mode: string) => void)('future');
                  setWarning(null);
                  setWarningAction(null);
                }}
                className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 text-xs rounded-lg hover:bg-amber-50 transition-colors"
              >
                Nur für zukünftige Bestellungen deaktivieren
              </button>
            )}
            <button
              onClick={() => {
                setWarning(null);
                setWarningAction(null);
              }}
              className="px-3 py-1.5 bg-white border border-smitten-cream text-smitten-text/60 text-xs rounded-lg hover:bg-smitten-bg transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {products.map((product) => (
          <div
            key={product.id}
            className="bg-white rounded-xl border border-smitten-cream overflow-hidden"
          >
            {editingId === product.id ? (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Name</label>
                    <input
                      type="text"
                      value={editForm.name || ''}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Preis (Cent)</label>
                    <input
                      type="number"
                      value={editForm.price_cents || 0}
                      onChange={(e) => setEditForm({ ...editForm, price_cents: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Kapazität</label>
                    <input
                      type="number"
                      value={editForm.capacity || 0}
                      onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Zyklus</label>
                    <select
                      value={editForm.cycle || 'permanent'}
                      onChange={(e) => setEditForm({ ...editForm, cycle: e.target.value as Product['cycle'] })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    >
                      <option value="permanent">Immer</option>
                      <option value="week_a">Woche A</option>
                      <option value="week_b">Woche B</option>
                      <option value="hidden">Versteckt</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Beschreibung</label>
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm text-smitten-text">
                    <input
                      type="checkbox"
                      checked={editForm.available_wed || false}
                      onChange={(e) => setEditForm({ ...editForm, available_wed: e.target.checked })}
                      className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
                    />
                    Mittwoch
                  </label>
                  <label className="flex items-center gap-2 text-sm text-smitten-text">
                    <input
                      type="checkbox"
                      checked={editForm.available_sat || false}
                      onChange={(e) => setEditForm({ ...editForm, available_sat: e.target.checked })}
                      className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
                    />
                    Samstag
                  </label>
                  <label className="flex items-center gap-2 text-sm text-smitten-text">
                    <input
                      type="checkbox"
                      checked={editForm.active || false}
                      onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                      className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
                    />
                    Aktiv
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveEdit}
                    className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
                  >
                    Speichern
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 border border-smitten-cream text-sm rounded-lg text-smitten-text/60 hover:bg-smitten-bg transition-colors"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-smitten-text">{product.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        product.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {product.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </div>
                    <p className="text-xs text-smitten-text/40 mt-0.5">
                      {formatPrice(product.price_cents)} · Kapazität: {product.capacity} · {cycleLabels[product.cycle] || product.cycle}
                      · {product.available_wed ? 'Mi' : ''} {product.available_sat ? 'Sa' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(product)}
                      className="px-3 py-1.5 bg-smitten-primary text-white text-xs rounded-lg hover:bg-smitten-primary/90 transition-colors"
                    >
                      Bearbeiten
                    </button>
                    {product.active && (
                      <button
                        onClick={() => emergencyDisable(product)}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Deaktivieren
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
