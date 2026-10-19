'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { showToast } from '@/components/admin/toast';
import { supabase } from '@/lib/supabase';
import { Card, Field, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, inputCls, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, fmtG, fmtPct, loadData } from '@/lib/production/client';
import { previewForBaseAmount, previewForPieces, sumPct, validateRecipe } from '@/lib/production/engine';
import type { ProductionData, Recipe, RecipeItem } from '@/lib/production/types';

type Draft = Omit<Recipe, 'items'> & { items: (RecipeItem & { key: string })[] };

let keyCounter = 1;
const newKey = () => `k${keyCounter++}`;

function emptyRecipe(): Draft {
  return { id: 'new', name: '', kind: 'dough', base_ingredient_id: null, dough_margin_factor: null, build_margin_pct: null, max_batch_g: null, per_batch_items: [], current_version: 0, notes: null, items: [] };
}

export default function RecipeEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const id = params.id;
  const [data, setData] = useState<ProductionData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [versions, setVersions] = useState<{ version_no: number; note: string | null; created_at: string }[]>([]);
  // preview
  const [previewProduct, setPreviewProduct] = useState('');
  const [previewPieces, setPreviewPieces] = useState('2');
  const [batchBase, setBatchBase] = useState('');
  const [batchGrams, setBatchGrams] = useState('40');
  const [ballG, setBallG] = useState('10');
  const [mode, setMode] = useState<'pieces' | 'batch'>(search.get('batch') ? 'batch' : 'pieces');

  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      if (id === 'new') { setDraft(emptyRecipe()); return; }
      const r = d.recipes.find((x) => x.id === id);
      if (!r) { setError('Recipe not found.'); return; }
      setDraft({ ...r, items: r.items.map((it) => ({ ...it, key: newKey() })) });
      const firstProduct = d.products.find((p) => p.recipe_id === r.id);
      if (firstProduct) setPreviewProduct(firstProduct.id);
      const base = r.base_ingredient_id ?? r.items.find((it) => it.type === 'ingredient' && Number(it.pct) === 100)?.ingredient_id ?? r.items.find((it) => it.type === 'ingredient')?.ingredient_id ?? '';
      setBatchBase(base);
      supabase.from('pr_recipe_versions').select('version_no, note, created_at').eq('recipe_id', r.id).order('version_no', { ascending: false }).then(({ data: v }) => setVersions(v ?? []));
    }).catch((e) => setError(e.message));
  }, [id]);

  const asRecipe = useMemo<Recipe | null>(() => draft ? { ...draft, items: draft.items.map((it, i) => ({ ...it, position: i + 1, pct: Number(it.pct) })) } : null, [draft]);
  const errors = useMemo(() => (asRecipe && data) ? validateRecipe(asRecipe, data) : [], [asRecipe, data]);

  const preview = useMemo(() => {
    if (!asRecipe || !data || errors.length) return null;
    if (mode === 'batch') {
      if (!batchBase || !(Number(batchGrams) > 0)) return null;
      return { kind: 'batch' as const, result: previewForBaseAmount(asRecipe, batchBase, Number(batchGrams), data) };
    }
    const p = data.products.find((x) => x.id === previewProduct);
    const dough = p ? p.dough_per_unit_g : null;
    if (!dough || !(Number(previewPieces) > 0)) return null;
    return { kind: 'pieces' as const, result: previewForPieces(asRecipe, Number(previewPieces), dough, data), product: p! };
  }, [asRecipe, data, errors, mode, batchBase, batchGrams, previewProduct, previewPieces]);

  function update(patch: Partial<Draft>) { setDraft((d) => d ? { ...d, ...patch } : d); }
  function updateItem(key: string, patch: Partial<RecipeItem>) {
    setDraft((d) => d ? { ...d, items: d.items.map((it) => it.key === key ? { ...it, ...patch } : it) } : d);
  }
  function addItem(type: RecipeItem['type']) {
    setDraft((d) => d ? { ...d, items: [...d.items, { key: newKey(), id: '', position: d.items.length + 1, type, ingredient_id: null, sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null, pct: 0, label: null }] } : d);
  }
  function move(key: string, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const i = d.items.findIndex((it) => it.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.items.length) return d;
      const items = [...d.items];
      [items[i], items[j]] = [items[j], items[i]];
      return { ...d, items };
    });
  }

  async function save() {
    if (!draft || !asRecipe) return;
    setBusy(true);
    try {
      const r = await adminFetch<{ id: string; version: number }>('/api/admin/production/recipes', {
        body: {
          recipe: {
            id: draft.id === 'new' ? null : draft.id, name: draft.name, kind: draft.kind, base_ingredient_id: draft.base_ingredient_id,
            dough_margin_factor: draft.dough_margin_factor, build_margin_pct: draft.build_margin_pct, max_batch_g: draft.max_batch_g,
            per_batch_items: draft.per_batch_items, notes: draft.notes,
            items: asRecipe.items.map((it) => ({ position: it.position, type: it.type, ingredient_id: it.ingredient_id, sub_recipe_id: it.sub_recipe_id, starter_id: it.starter_id, final_flour_ingredient_id: it.final_flour_ingredient_id, pct: it.pct, label: it.label })),
          },
          note: note || null,
        },
      });
      showToast(`Saved as version ${r.version}.`, 'success');
      if (draft.id === 'new') router.replace(`/admin/production/recipes/${r.id}`);
      else { setNote(''); window.location.reload(); }
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data || !draft) return <AdminLoading what="recipe" />;

  const ingredients = data.ingredients;
  const subs = data.recipes.filter((r) => r.kind === 'sub' && r.id !== draft.id);
  const starters = data.starters;
  const linkedProducts = data.products.filter((p) => p.recipe_id === draft.id);

  return (
    <div>
      <PageHeader
        title={draft.id === 'new' ? 'New recipe' : draft.name}
        subtitle={draft.id === 'new' ? undefined : <>Version {draft.current_version}{linkedProducts.length ? ` · products: ${linkedProducts.map((p) => p.name).join(', ')}` : ' · no product linked'}</>}
        actions={<>
          <Link href="/admin/production/recipes" className={btnSecondary}>Back</Link>
          <button className={btnPrimary} onClick={save} disabled={busy || errors.length > 0}>Save{draft.id === 'new' ? '' : ' as new version'}</button>
        </>}
      />
      <SubNav current="/admin/production/recipes" />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3 space-y-6">
          <Card title="Recipe">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name"><input className={`${inputCls} w-full`} value={draft.name} onChange={(e) => update({ name: e.target.value })} /></Field>
              <Field label="Kind">
                <select className={`${inputCls} w-full`} value={draft.kind} onChange={(e) => update({ kind: e.target.value as Recipe['kind'] })}>
                  <option value="dough">dough (a product is made from it)</option>
                  <option value="sub">sub-recipe (pre-dough, poolish, soaker)</option>
                </select>
              </Field>
              {draft.kind === 'dough' ? (
                <Field label="Dough margin factor" hint={`Empty = default ${data.settings.dough_margin_factor}. Adds factor × Σ% grams of dough per batch.`}>
                  <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={draft.dough_margin_factor ?? ''} onChange={(e) => update({ dough_margin_factor: e.target.value === '' ? null : Number(e.target.value) })} />
                </Field>
              ) : (
                <Field label="Build margin %" hint={`Empty = default ${data.settings.build_margin_pct} %. Applied to the amount the parent needs.`}>
                  <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={draft.build_margin_pct ?? ''} onChange={(e) => update({ build_margin_pct: e.target.value === '' ? null : Number(e.target.value) })} />
                </Field>
              )}
              <Field label="Max batch g" hint="Mixer limit; larger batches are split and the margin applies per batch.">
                <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={draft.max_batch_g ?? ''} onChange={(e) => update({ max_batch_g: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label="Base ingredient (optional)" hint="If set, its lines must add up to 100 %.">
                <select className={`${inputCls} w-full`} value={draft.base_ingredient_id ?? ''} onChange={(e) => update({ base_ingredient_id: e.target.value || null })}>
                  <option value="">—</option>
                  {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Notes" className="md:col-span-2"><input className={`${inputCls} w-full`} value={draft.notes ?? ''} onChange={(e) => update({ notes: e.target.value || null })} /></Field>
            </div>
          </Card>

          <Card title={<span>Lines <span className="text-xs font-normal text-smitten-text/50">Σ {fmtPct(sumPct(asRecipe!))} %</span></span>}>
            <table className="w-full">
              <thead><tr><th className={th}>#</th><th className={th}>Type</th><th className={`${th} w-full`}>Item</th><th className={`${th} text-right`}>%</th><th className={th}>Label / final flour</th><th className={th}></th></tr></thead>
              <tbody>
                {draft.items.map((it, i) => (
                  <tr key={it.key} className="border-t border-smitten-cream">
                    <td className={`${td} text-smitten-text/50`}>{i + 1}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <select className={`${smallInputCls} w-24`} value={it.type} onChange={(e) => updateItem(it.key, { type: e.target.value as RecipeItem['type'], ingredient_id: null, sub_recipe_id: null, starter_id: null, final_flour_ingredient_id: null })}>
                        <option value="ingredient">ingredient</option><option value="sub">sub-recipe</option><option value="starter">starter</option>
                      </select>
                    </td>
                    <td className={td}>
                      {it.type === 'ingredient' && (
                        <select className={`${smallInputCls} w-full`} value={it.ingredient_id ?? ''} onChange={(e) => updateItem(it.key, { ingredient_id: e.target.value || null })}>
                          <option value="">choose…</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      )}
                      {it.type === 'sub' && (
                        <select className={`${smallInputCls} w-full`} value={it.sub_recipe_id ?? ''} onChange={(e) => updateItem(it.key, { sub_recipe_id: e.target.value || null })}>
                          <option value="">choose…</option>{subs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      )}
                      {it.type === 'starter' && (
                        <select className={`${smallInputCls} w-full`} value={it.starter_id ?? ''} onChange={(e) => updateItem(it.key, { starter_id: e.target.value || null })}>
                          <option value="">choose…</option>{starters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className={`${tdNum} whitespace-nowrap`}><input className={`${smallInputCls} w-20 text-right`} type="number" step="any" min="0" value={it.pct} onChange={(e) => updateItem(it.key, { pct: e.target.value as unknown as number })} /></td>
                    <td className={`${td} whitespace-nowrap`}>
                      <input className={`${smallInputCls} w-28`} placeholder="label (optional)" value={it.label ?? ''} onChange={(e) => updateItem(it.key, { label: e.target.value || null })} />
                      {it.type === 'starter' && (
                        <select className={`${smallInputCls} block mt-1 w-28`} value={it.final_flour_ingredient_id ?? ''} onChange={(e) => updateItem(it.key, { final_flour_ingredient_id: e.target.value || null })} title="Flour for the last refresh (when the starter takes it from the recipe)">
                          <option value="">final flour: starter default</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button className="text-xs px-1 text-smitten-text/60 hover:text-smitten-text" onClick={() => move(it.key, -1)} title="up">↑</button>
                      <button className="text-xs px-1 text-smitten-text/60 hover:text-smitten-text" onClick={() => move(it.key, 1)} title="down">↓</button>
                      <button className="text-xs px-1 text-red-700 dark:text-red-400" onClick={() => setDraft((d) => d ? { ...d, items: d.items.filter((x) => x.key !== it.key) } : d)} title="remove">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={btnSecondary} onClick={() => addItem('ingredient')}>+ ingredient</button>
              <button className={btnSecondary} onClick={() => addItem('sub')}>+ sub-recipe</button>
              <button className={btnSecondary} onClick={() => addItem('starter')}>+ starter</button>
            </div>
          </Card>

          <Card title="Per batch (fixed amounts, once per batch)">
            <p className="text-xs text-smitten-text/50 mb-2">E.g. one whole egg for the egg wash. In the ingredient&apos;s unit; counted for stock and cost once per batch, never scaled with quantity.</p>
            {draft.per_batch_items.map((p, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select className={smallInputCls} value={p.ingredient_id} onChange={(e) => update({ per_batch_items: draft.per_batch_items.map((x, j) => j === i ? { ...x, ingredient_id: e.target.value } : x) })}>
                  <option value="">choose…</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <input className={`${smallInputCls} w-24`} type="number" step="any" min="0" value={p.amount} onChange={(e) => update({ per_batch_items: draft.per_batch_items.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x) })} />
                <span className="text-xs text-smitten-text/50">{ingredients.find((x) => x.id === p.ingredient_id)?.unit ?? ''}</span>
                <button className="text-xs text-red-700 dark:text-red-400" onClick={() => update({ per_batch_items: draft.per_batch_items.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button className={btnSecondary} onClick={() => update({ per_batch_items: [...draft.per_batch_items, { ingredient_id: '', amount: 1 }] })}>+ per-batch item</button>
          </Card>

          {errors.length > 0 && <Notice tone="error"><ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}

          <Card title="Save">
            <Field label="Version note (optional)" hint='E.g. "flour absorbs less water".'>
              <input className={`${inputCls} w-full`} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-3"><button className={btnPrimary} onClick={save} disabled={busy || errors.length > 0}>Save{draft.id === 'new' ? '' : ' as new version'}</button></div>
          </Card>
        </div>

        <div className="xl:col-span-2 space-y-6">
          <Card title="Preview" right={
            <div className="flex gap-1 text-xs">
              <button className={`px-2 py-1 rounded ${mode === 'pieces' ? 'bg-smitten-primary text-white' : 'hover:bg-smitten-cream'}`} onClick={() => setMode('pieces')}>for n pieces</button>
              <button className={`px-2 py-1 rounded ${mode === 'batch' ? 'bg-smitten-primary text-white' : 'hover:bg-smitten-cream'}`} onClick={() => setMode('batch')}>make batch</button>
            </div>
          }>
            {mode === 'pieces' ? (
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <Field label="Product">
                  <select className={smallInputCls} value={previewProduct} onChange={(e) => setPreviewProduct(e.target.value)}>
                    <option value="">choose…</option>
                    {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.dough_per_unit_g} g)</option>)}
                  </select>
                </Field>
                <Field label="Pieces"><input className={`${smallInputCls} w-20`} type="number" min="1" step="1" value={previewPieces} onChange={(e) => setPreviewPieces(e.target.value)} /></Field>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <Field label="Base ingredient">
                  <select className={smallInputCls} value={batchBase} onChange={(e) => setBatchBase(e.target.value)}>
                    <option value="">choose…</option>
                    {draft.items.filter((it) => it.type === 'ingredient' && it.ingredient_id).map((it) => <option key={it.key} value={it.ingredient_id!}>{ingredients.find((x) => x.id === it.ingredient_id)?.name}</option>)}
                  </select>
                </Field>
                <Field label="Grams"><input className={`${smallInputCls} w-20`} type="number" min="0" step="any" value={batchGrams} onChange={(e) => setBatchGrams(e.target.value)} /></Field>
                <Field label="g per ball"><input className={`${smallInputCls} w-20`} type="number" min="0" step="any" value={ballG} onChange={(e) => setBallG(e.target.value)} /></Field>
              </div>
            )}
            {!preview && <p className="text-sm text-smitten-text/50">{errors.length ? 'Fix the errors to see a preview.' : 'Choose what to calculate.'}</p>}
            {preview?.kind === 'pieces' && (
              <div className="text-sm">
                <p className="text-xs text-smitten-text/60 mb-2">
                  {previewPieces} × {preview.product.dough_per_unit_g} g = {fmtG(preview.result.block.total_dough_g)} g dough · factor {preview.result.block.factor.toFixed(4)} · margin +{fmtG(preview.result.block.margin_g_per_batch)} g
                  {preview.result.block.batches > 1 && <span className="text-amber-700 dark:text-amber-300"> · {preview.result.block.batches} batches, per batch below</span>}
                </p>
                <table className="w-full">
                  <tbody>
                    {preview.result.block.lines.map((l) => <tr key={l.item_id} className="border-t border-smitten-cream"><td className={td}>{l.label}</td><td className={tdNum}>{fmtPct(l.pct)}</td><td className={`${tdNum} font-medium`}>{fmtG(l.grams)}</td></tr>)}
                    {preview.result.block.starters.map((s) => <tr key={s.item_id} className="border-t border-smitten-cream"><td className={td}>{s.label}<span className="block text-xs text-smitten-text/50">final build {fmtG(s.final_build_g)} = {fmtG(s.flour_g)} {s.flour_ingredient_name} / {fmtG(s.water_g)} / {fmtG(s.seed_g)}</span></td><td className={tdNum}></td><td className={`${tdNum} font-medium`}>{fmtG(s.in_dough_g)}</td></tr>)}
                    {preview.result.block.subs.map((b) => <tr key={b.recipe_id} className="border-t border-smitten-cream"><td className={td}>{b.name}<span className="block text-xs text-smitten-text/50">{b.lines.map((l) => `${l.label} ${fmtG(l.grams)}`).join(' · ')}</span></td><td className={tdNum}></td><td className={`${tdNum} font-medium`}>{fmtG(b.total_g)}</td></tr>)}
                    <tr className="border-t-2 border-smitten-cream font-medium"><td className={td}>Total</td><td className={tdNum}>{fmtPct(preview.result.block.sum_pct)}</td><td className={tdNum}>{fmtG(preview.result.block.batch_total_g)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {preview?.kind === 'batch' && (
              <div className="text-sm">
                <p className="text-xs text-smitten-text/60 mb-2">factor {preview.result.factor.toFixed(4)} · dough {fmtG(preview.result.total_g)} g{Number(ballG) > 0 && <> = <span className="font-medium">{Math.floor(preview.result.total_g / Number(ballG))} balls</span> of {ballG} g</>}</p>
                <table className="w-full">
                  <tbody>
                    {preview.result.lines.map((l) => <tr key={l.item_id} className="border-t border-smitten-cream"><td className={td}>{l.label}</td><td className={tdNum}>{fmtPct(l.pct)}</td><td className={`${tdNum} font-medium`}>{fmtG(l.grams)}</td></tr>)}
                    <tr className="border-t-2 border-smitten-cream font-medium"><td className={td}>Total</td><td></td><td className={tdNum}>{fmtG(preview.result.total_g)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {versions.length > 0 && (
            <Card title="Versions">
              <ul className="text-sm divide-y divide-smitten-cream">
                {versions.map((v) => <li key={v.version_no} className="py-1.5 flex justify-between gap-2"><span>v{v.version_no}{v.note ? ` · ${v.note}` : ''}</span><span className="text-xs text-smitten-text/50">{new Date(v.created_at).toLocaleString('en-GB')}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
