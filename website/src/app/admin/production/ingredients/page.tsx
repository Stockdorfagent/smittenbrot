'use client';

import { useEffect, useState } from 'react';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Bold, Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, btnDanger, smallInputCls, th, td } from '@/components/admin/production/ui';
import { adminFetch, loadData } from '@/lib/production/client';
import type { Ingredient, ProductionData } from '@/lib/production/types';

type Form = {
  id?: string; name: string; unit: 'g' | 'pcs'; name_de: string; allergens: string; // '' = not checked, 'none', or 'a|b'
  components_de: string; derived_from: string; g_per_source_unit: string; notes: string;
  track_stock: boolean; track_bbf: boolean; reorder_level: string; made_from_recipe_id: string;
};

function toForm(i: Ingredient): Form {
  return {
    id: i.id, name: i.name, unit: i.unit, name_de: i.name_de ?? '', allergens: i.allergens === null ? '' : (i.allergens.length ? i.allergens.join('|') : 'none'),
    components_de: i.components_de ?? '', derived_from: i.derived_from ?? '', g_per_source_unit: i.g_per_source_unit?.toString() ?? '', notes: i.notes ?? '',
    track_stock: i.track_stock, track_bbf: i.track_bbf, reorder_level: i.reorder_level?.toString() ?? '', made_from_recipe_id: i.made_from_recipe_id ?? '',
  };
}
const EMPTY: Form = { name: '', unit: 'g', name_de: '', allergens: '', components_de: '', derived_from: '', g_per_source_unit: '', notes: '', track_stock: true, track_bbf: false, reorder_level: '', made_from_recipe_id: '' };

export default function IngredientsPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = () => loadData().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const allergRaw = editing.allergens.trim();
      await adminFetch('/api/admin/production/ingredients', {
        body: {
          ingredient: {
            id: editing.id, name: editing.name, unit: editing.unit, name_de: editing.name_de,
            allergens: allergRaw === '' ? null : allergRaw.toLowerCase() === 'none' ? 'none' : allergRaw.split('|').map((a) => a.trim()).filter(Boolean),
            components_de: editing.components_de, derived_from: editing.derived_from || null, g_per_source_unit: editing.g_per_source_unit, notes: editing.notes,
            track_stock: editing.track_stock, track_bbf: editing.track_bbf, reorder_level: editing.reorder_level, made_from_recipe_id: editing.made_from_recipe_id || null,
          },
        },
      });
      showToast('Ingredient saved.', 'success');
      setEditing(null);
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function remove(i: Ingredient) {
    if (!confirm(`Delete ingredient "${i.name}"?`)) return;
    try {
      await adminFetch('/api/admin/production/ingredients', { method: 'DELETE', body: { id: i.id } });
      showToast('Deleted.', 'success');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <AdminLoading what="ingredients" />;

  const byId = new Map(data.ingredients.map((i) => [i.id, i]));
  const recipeName = new Map(data.recipes.map((r) => [r.id, r.name]));
  const rows = data.ingredients.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()) || (i.name_de ?? '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Ingredients"
        subtitle="Internal name (any language) for the bake sheet; German name, allergens and components for the customer lists. Grams for everything except eggs and packaging."
        actions={<>
          <input className={smallInputCls} placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className={btnPrimary} onClick={() => setEditing({ ...EMPTY })}>New ingredient</button>
        </>}
      />
      <SubNav current="/admin/production/ingredients" />

      {editing && (
        <Card title={editing.id ? `Edit ${editing.name}` : 'New ingredient'} className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <L label="Internal name"><input className={`${smallInputCls} w-full`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></L>
            <L label="Unit"><select className={`${smallInputCls} w-full`} value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value as 'g' | 'pcs' })}><option value="g">g</option><option value="pcs">pcs</option></select></L>
            <L label="German name (customer-facing), allergen part in **…**"><input className={`${smallInputCls} w-full`} value={editing.name_de} onChange={(e) => setEditing({ ...editing, name_de: e.target.value })} placeholder="**Weizen**mehl" /></L>
            <L label="Allergens — Annex II terms separated by |, 'none', or empty = not checked"><input className={`${smallInputCls} w-full`} value={editing.allergens} onChange={(e) => setEditing({ ...editing, allergens: e.target.value })} placeholder="Weizen|Roggen · none" /></L>
            <L label="Components (compound ingredient, verbatim from the packaging)" className="md:col-span-2"><input className={`${smallInputCls} w-full`} value={editing.components_de} onChange={(e) => setEditing({ ...editing, components_de: e.target.value })} placeholder="Oliven, Wasser, Salz, Stabilisator (Eisen-II-gluconat)" /></L>
            <L label="Derived from (e.g. egg yolk ← egg)">
              <select className={`${smallInputCls} w-full`} value={editing.derived_from} onChange={(e) => setEditing({ ...editing, derived_from: e.target.value })}>
                <option value="">—</option>
                {data.ingredients.filter((i) => i.id !== editing.id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </L>
            <L label="g per source unit (yolk: 17 g per egg)"><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={editing.g_per_source_unit} onChange={(e) => setEditing({ ...editing, g_per_source_unit: e.target.value })} /></L>
            <L label="Notes"><input className={`${smallInputCls} w-full`} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></L>
            <div className="flex items-end gap-4 md:col-span-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.track_stock} onChange={(e) => setEditing({ ...editing, track_stock: e.target.checked })} /> Count in stock</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.track_bbf} onChange={(e) => setEditing({ ...editing, track_bbf: e.target.checked })} /> Best-before date</label>
            </div>
            <L label={`Reorder level (${editing.unit})`}><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={editing.reorder_level} onChange={(e) => setEditing({ ...editing, reorder_level: e.target.value })} /></L>
            <L label="Made in-house from recipe (batches on Stock)">
              <select className={`${smallInputCls} w-full`} value={editing.made_from_recipe_id} onChange={(e) => setEditing({ ...editing, made_from_recipe_id: e.target.value })}>
                <option value="">— bought</option>
                {[...data.recipes].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'sub' ? -1 : 1)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </L>
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={busy || !editing.name.trim()}>Save</button>
            <button className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </Card>
      )}

      <Card>
        <table className="w-full">
          <thead><tr><th className={th}>Name</th><th className={th}>Unit</th><th className={th}>German name</th><th className={th}>Allergens</th><th className={th}>Components</th><th className={th}>Derived / made</th><th className={th}></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="border-t border-smitten-cream">
                <td className={`${td} font-medium`}>{i.name}</td>
                <td className={td}>{i.unit}</td>
                <td className={td}><Bold text={i.name_de ?? ''} /></td>
                <td className={td}>
                  {i.allergens === null ? <StatusPill tone="amber">not checked</StatusPill> : i.allergens.length === 0 ? <span className="text-smitten-text/40">none</span> : i.allergens.join(', ')}
                </td>
                <td className={`${td} text-xs text-smitten-text/70`}><Bold text={i.components_de ?? ''} /></td>
                <td className={`${td} text-xs text-smitten-text/70`}>{i.derived_from ? `${byId.get(i.derived_from)?.name ?? '?'} · ${i.g_per_source_unit} g/unit` : i.made_from_recipe_id ? `in-house · ${recipeName.get(i.made_from_recipe_id) ?? '?'}` : ''}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <button className="text-sm text-smitten-text/70 hover:text-smitten-primary mr-2" onClick={() => { setEditing(toForm(i)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>edit</button>
                  <button className={btnDanger} onClick={() => remove(i)}>delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function L({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className ?? ''}`}><span className="block text-[11px] text-smitten-text/60 mb-1">{label}</span>{children}</label>;
}
