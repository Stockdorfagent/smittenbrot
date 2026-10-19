'use client';

import { useEffect, useState } from 'react';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { supabase } from '@/lib/supabase';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, btnDanger, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, loadData } from '@/lib/production/client';
import type { ProductLink, ProductionData } from '@/lib/production/types';

type Form = {
  id?: string; channel: 'web' | 'intern'; product_id: string; name: string; recipe_id: string; dough_per_unit_g: string; bake_loss_pct: string;
  production: 'orders' | 'stock'; pieces_per_unit: string; extras: { ingredient_id: string; grams: string }[];
};
const EMPTY: Form = { channel: 'web', product_id: '', name: '', recipe_id: '', dough_per_unit_g: '', bake_loss_pct: '', production: 'orders', pieces_per_unit: '', extras: [] };

function toForm(p: ProductLink): Form {
  return {
    id: p.id, channel: p.channel, product_id: p.product_id ?? '', name: p.name, recipe_id: p.recipe_id ?? '', dough_per_unit_g: String(p.dough_per_unit_g),
    bake_loss_pct: p.bake_loss_pct?.toString() ?? '', production: p.production, pieces_per_unit: p.pieces_per_unit?.toString() ?? '',
    extras: p.extras.map((e) => ({ ingredient_id: e.ingredient_id, grams: String(e.grams) })),
  };
}

export default function ProductsPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [shop, setShop] = useState<{ id: string; name: string; active: boolean; unit_label: string | null }[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [d, s] = await Promise.all([loadData(), supabase.from('products').select('id, name, active, unit_label').order('name')]);
      setData(d); setShop(s.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/products', {
        body: {
          product: {
            id: editing.id, channel: editing.channel, product_id: editing.channel === 'web' ? editing.product_id || null : null, name: editing.name,
            recipe_id: editing.recipe_id || null, dough_per_unit_g: editing.dough_per_unit_g, bake_loss_pct: editing.bake_loss_pct, production: editing.production,
            pieces_per_unit: editing.pieces_per_unit, extras: editing.extras.filter((e) => e.ingredient_id).map((e) => ({ ingredient_id: e.ingredient_id, grams: Number(e.grams) })),
          },
        },
      });
      showToast('Product saved.', 'success');
      setEditing(null);
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function remove(p: ProductLink) {
    if (!confirm(`Remove "${p.name}" from production? (The shop product itself is not touched.)`)) return;
    try {
      await adminFetch('/api/admin/production/products', { method: 'DELETE', body: { id: p.id } });
      showToast('Removed.', 'success');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <AdminLoading what="products" />;

  const recipeName = new Map(data.recipes.map((r) => [r.id, r.name]));
  const ingName = new Map(data.ingredients.map((i) => [i.id, i.name]));
  const linkedShopIds = new Set(data.products.map((p) => p.product_id).filter(Boolean));
  const unlinkedShop = shop.filter((s) => !linkedShopIds.has(s.id));
  const doughs = data.recipes.filter((r) => r.kind === 'dough');

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Which recipe makes which product, dough weight per piece, per-piece extras. Shop products are linked by ID, internal products exist only here."
        actions={<button className={btnPrimary} onClick={() => setEditing({ ...EMPTY })}>Add product</button>}
      />
      <SubNav current="/admin/production/products" />

      {unlinkedShop.filter((s) => s.active).length > 0 && (
        <div className="mb-6"><Notice tone="warning">Active shop products without production data: {unlinkedShop.filter((s) => s.active).map((s) => s.name).join(', ')}. Orders for them appear as a warning on the bake sheet.</Notice></div>
      )}

      {editing && (
        <Card title={editing.id ? `Edit ${editing.name}` : 'Add product'} className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <L label="Channel">
              <select className={`${smallInputCls} w-full`} value={editing.channel} onChange={(e) => setEditing({ ...editing, channel: e.target.value as Form['channel'] })} disabled={!!editing.id}>
                <option value="web">web (shop product)</option><option value="intern">internal (B2B only)</option>
              </select>
            </L>
            {editing.channel === 'web' ? (
              <L label="Shop product" className="md:col-span-2">
                <select className={`${smallInputCls} w-full`} value={editing.product_id} onChange={(e) => setEditing({ ...editing, product_id: e.target.value, name: shop.find((s) => s.id === e.target.value)?.name ?? editing.name })}>
                  <option value="">— not yet in the shop (pending link by exact name) —</option>
                  {shop.filter((s) => !linkedShopIds.has(s.id) || s.id === editing.product_id).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (inactive)'}</option>)}
                </select>
                {!editing.product_id && <input className={`${smallInputCls} w-full mt-1`} placeholder="exact future shop name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
              </L>
            ) : (
              <L label="Name" className="md:col-span-2"><input className={`${smallInputCls} w-full`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></L>
            )}
            <L label="Recipe (dough)">
              <select className={`${smallInputCls} w-full`} value={editing.recipe_id} onChange={(e) => setEditing({ ...editing, recipe_id: e.target.value })}>
                <option value="">—</option>{doughs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </L>
            <L label="Dough per piece (g)"><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={editing.dough_per_unit_g} onChange={(e) => setEditing({ ...editing, dough_per_unit_g: e.target.value })} /></L>
            <L label="Bake loss % (optional)"><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={editing.bake_loss_pct} onChange={(e) => setEditing({ ...editing, bake_loss_pct: e.target.value })} /></L>
            <L label="Production">
              <select className={`${smallInputCls} w-full`} value={editing.production} onChange={(e) => setEditing({ ...editing, production: e.target.value as Form['production'] })}>
                <option value="orders">orders — dough calculated from orders on the bake day</option>
                <option value="stock">stock — made in batches, taken from the freezer</option>
              </select>
            </L>
            <L label="Pieces per unit (e.g. 5 balls per bag)"><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={editing.pieces_per_unit} onChange={(e) => setEditing({ ...editing, pieces_per_unit: e.target.value })} /></L>
          </div>
          <div className="mt-3">
            <p className="text-[11px] text-smitten-text/60 mb-1">Extras per piece (grams, outside the dough: deco, topping, coating)</p>
            {editing.extras.map((e, i) => (
              <div key={i} className="flex items-center gap-2 mb-1">
                <select className={smallInputCls} value={e.ingredient_id} onChange={(ev) => setEditing({ ...editing, extras: editing.extras.map((x, j) => j === i ? { ...x, ingredient_id: ev.target.value } : x) })}>
                  <option value="">choose…</option>{data.ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input className={`${smallInputCls} w-24`} type="number" step="any" min="0" value={e.grams} onChange={(ev) => setEditing({ ...editing, extras: editing.extras.map((x, j) => j === i ? { ...x, grams: ev.target.value } : x) })} /> <span className="text-xs text-smitten-text/50">g</span>
                <button className="text-xs text-red-700 dark:text-red-400" onClick={() => setEditing({ ...editing, extras: editing.extras.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className={btnSecondary} onClick={() => setEditing({ ...editing, extras: [...editing.extras, { ingredient_id: '', grams: '' }] })}>+ extra</button>
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={busy}>Save</button>
            <button className={btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </Card>
      )}

      <Card>
        <table className="w-full">
          <thead><tr><th className={th}>Product</th><th className={th}>Link</th><th className={th}>Recipe</th><th className={`${th} text-right`}>Dough g</th><th className={`${th} text-right`}>Loss %</th><th className={th}>Production</th><th className={th}>Extras / piece</th><th className={th}></th></tr></thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.id} className="border-t border-smitten-cream">
                <td className={`${td} font-medium`}>{p.name}</td>
                <td className={td}>
                  {p.link_status === 'linked' && <StatusPill tone="green">shop</StatusPill>}
                  {p.link_status === 'pending' && <StatusPill tone="amber">pending</StatusPill>}
                  {p.link_status === 'internal' && <StatusPill tone="gray">internal</StatusPill>}
                </td>
                <td className={td}>{p.recipe_id ? recipeName.get(p.recipe_id) : <StatusPill tone="red">no recipe</StatusPill>}</td>
                <td className={tdNum}>{p.dough_per_unit_g}</td>
                <td className={tdNum}>{p.bake_loss_pct ?? ''}</td>
                <td className={td}>{p.production}{p.pieces_per_unit ? ` · ${p.pieces_per_unit} pcs/unit` : ''}</td>
                <td className={`${td} text-xs text-smitten-text/70`}>{p.extras.map((e) => `${ingName.get(e.ingredient_id) ?? '?'} ${e.grams} g`).join(', ')}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <button className="text-sm text-smitten-text/70 hover:text-smitten-primary mr-2" onClick={() => setEditing(toForm(p))}>edit</button>
                  <button className={btnDanger} onClick={() => remove(p)}>remove</button>
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
