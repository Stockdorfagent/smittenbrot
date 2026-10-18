'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, adminDownload, fmtG, fmtPct } from '@/lib/production/client';
import { computeBakeSheet } from '@/lib/production/engine';
import { b2bDemands } from '@/lib/production/b2b';
import type { PlannedClient } from '@/lib/production/b2b';
import type { FreezerStatus } from '@/lib/production/freezer';
import { formatDateEN, isValidISODate } from '@/lib/production/bakeDays';
import type { Adjustment, BakeSheet, Demand, GramLine, ManualOrder, ProductionData, RecipeBlock, StarterNeed, SubBlock, B2BClient, DayOverride, StandingOrder } from '@/lib/production/types';

interface DayResponse {
  sheet: BakeSheet;
  row: { extra_quantities: { pr_product_id: string; qty: number; reason: string | null }[]; adjustments: Adjustment[]; notes: string | null; snapshot_at: string | null };
  frozen: boolean;
  cutoff: { date: string; hour: number; passed: boolean; label: string };
  is_bake_day: boolean;
  data: ProductionData;
  b2b: { planned: PlannedClient[]; manual: ManualOrder[]; overrides: DayOverride[]; clients: B2BClient[]; standing: StandingOrder[] };
  web: Demand[];
  freezer: FreezerStatus[];
}

export default function BakeDayPage() {
  const params = useParams<{ date: string }>();
  const date = params.date;
  const [res, setRes] = useState<DayResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // local, unsaved edits
  const [extras, setExtras] = useState<{ pr_product_id: string; qty: number; reason: string | null }[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [newExtra, setNewExtra] = useState<{ pr_product_id: string; qty: string; reason: string }>({ pr_product_id: '', qty: '', reason: 'Freezer stock' });
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (live = false) => {
    try {
      const r = await adminFetch<DayResponse>(`/api/admin/production/bake-day?date=${date}${live ? '&live=1' : ''}`);
      setRes(r);
      setExtras(r.row.extra_quantities);
      setAdjustments(r.row.adjustments);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [date]);

  useEffect(() => { if (isValidISODate(date)) load(); else setError('Invalid date.'); }, [date, load]);

  /** Live recalculation in the browser while the owner edits extras or percentages (frozen days show the snapshot). */
  const sheet = useMemo<BakeSheet | null>(() => {
    if (!res) return null;
    if (res.frozen && !dirty) return res.sheet;
    const byId = new Map(res.data.products.map((p) => [p.id, p]));
    const extraDemands: Demand[] = extras.map((e) => ({ pr_product_id: e.pr_product_id, product_name: byId.get(e.pr_product_id)?.name ?? '?', qty: e.qty, source: 'extra' as const, reason: e.reason }));
    return computeBakeSheet(date, [...res.web, ...b2bDemands(res.b2b, res.data.products, res.b2b.clients), ...extraDemands], res.data, adjustments);
  }, [res, extras, adjustments, dirty, date]);

  async function save() {
    setBusy(true);
    try {
      const r = await adminFetch<DayResponse>('/api/admin/production/bake-day', { body: { date, action: 'save_day', extra_quantities: extras, adjustments } });
      setRes(r); setExtras(r.row.extra_quantities); setAdjustments(r.row.adjustments); setDirty(false);
      showToast('Bake day saved.', 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function recompute() {
    if (!confirm('Drop the frozen snapshot and calculate this day again from the current recipes and orders?')) return;
    setBusy(true);
    try {
      const r = await adminFetch<DayResponse>('/api/admin/production/bake-day', { body: { date, action: 'recompute' } });
      setRes(r); setExtras(r.row.extra_quantities); setAdjustments(r.row.adjustments); setDirty(false);
      showToast('Recalculated.', 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function saveAdjustmentAsVersion(recipeId: string) {
    if (!res) return;
    const recipe = res.data.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const mine = adjustments.filter((a) => a.recipe_id === recipeId);
    if (mine.length === 0) return;
    const note = prompt(`Save today's percentages as a new version of "${recipe.name}"? Optional note:`, 'adjusted on the bake sheet');
    if (note === null) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/recipes', {
        body: {
          recipe: {
            id: recipe.id, name: recipe.name, kind: recipe.kind, base_ingredient_id: recipe.base_ingredient_id, dough_margin_factor: recipe.dough_margin_factor,
            build_margin_pct: recipe.build_margin_pct, max_batch_g: recipe.max_batch_g, per_batch_items: recipe.per_batch_items, notes: recipe.notes,
            items: recipe.items.map((it) => ({ ...it, pct: mine.find((a) => a.item_id === it.id)?.pct ?? it.pct })),
          },
          note,
        },
      });
      // the lines get new ids with the new version: drop the day's overrides for this recipe and reload
      setAdjustments((prev) => prev.filter((a) => a.recipe_id !== recipeId));
      await adminFetch('/api/admin/production/bake-day', { body: { date, action: 'save_day', extra_quantities: extras, adjustments: adjustments.filter((a) => a.recipe_id !== recipeId) } });
      await load();
      showToast(`New version of ${recipe.name} saved.`, 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function setAdj(recipeId: string, itemId: string, pct: string, original: number) {
    const n = Number(pct);
    setAdjustments((prev) => {
      const rest = prev.filter((a) => !(a.recipe_id === recipeId && a.item_id === itemId));
      if (pct === '' || !Number.isFinite(n) || n === original) return rest;
      return [...rest, { recipe_id: recipeId, item_id: itemId, pct: n }];
    });
    setDirty(true);
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!res || !sheet) return <AdminLoading what="bake sheet" />;

  const products = res.data.products;
  const starterInSub = new Set(sheet.recipes.flatMap((r) => r.subs.flatMap(collectStarterItemIds)));

  return (
    <div className="print:text-black">
      <PageHeader
        title={`Bake sheet · ${formatDateEN(date)}`}
        subtitle={<>
          {res.is_bake_day ? null : <span className="text-amber-700">Not a regular bake day. </span>}
          Cut-off {res.cutoff.label} Berlin — {res.cutoff.passed ? 'passed, orders are final' : 'not yet passed, orders can still come in'}.
          {res.frozen && res.row.snapshot_at ? ` Frozen snapshot from ${new Date(res.row.snapshot_at).toLocaleString('en-GB')}.` : ' Live.'}
        </>}
        actions={<>
          <button className={btnSecondary} onClick={() => window.print()}>Print</button>
          <button className={btnSecondary} onClick={() => adminDownload(`/api/admin/production/bake-day/xlsx?date=${date}`, `${date}_bake-sheet.xlsx`).catch((e) => showToast(e.message))}>Excel</button>
          {res.frozen && <button className={btnSecondary} onClick={recompute} disabled={busy}>Recalculate</button>}
          {dirty && <button className={btnPrimary} onClick={save} disabled={busy}>Save day</button>}
        </>}
      />
      <SubNav current="/admin/production" />

      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold">Bake sheet {formatDateEN(date)}</h1>
      </div>

      {sheet.warnings.length > 0 && (
        <div className="space-y-2 mb-6">
          {sheet.warnings.map((w, i) => (
            <Notice key={i} tone={w.type === 'missing_recipe' ? 'error' : 'warning'}>
              {w.text}{w.type === 'missing_recipe' && <> — <Link href="/admin/production/products" className="underline print:hidden">link a recipe</Link></>}
            </Notice>
          ))}
        </div>
      )}
      {dirty && <div className="mb-4 print:hidden"><Notice tone="info">Unsaved changes — the figures below already reflect them. Click “Save day” to keep them for this bake day.</Notice></div>}

      {/* Quantities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 print:block">
        <Card title="Quantities" className="print:border-0 print:p-0 print:mb-4">
          <table className="w-full">
            <thead><tr><th className={th}>Product</th><th className={`${th} text-right`}>Web</th><th className={`${th} text-right`}>B2B</th><th className={`${th} text-right`}>Other</th><th className={`${th} text-right`}>Extra</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Dough</th></tr></thead>
            <tbody>
              {sheet.products.map((p) => {
                const sum = (src: Demand['source']) => p.by_source.filter((s) => s.source === src).reduce((n, s) => n + s.qty, 0);
                const who = (src: Demand['source']) => p.by_source.filter((s) => s.source === src).map((s) => s.reason).filter(Boolean).join(', ');
                const cell = (src: Demand['source']) => { const n = sum(src); return n ? <span>{n}{who(src) && <span className="block text-[11px] text-smitten-text/50">{who(src)}</span>}</span> : ''; };
                return (
                  <tr key={p.pr_product_id} className="border-t border-smitten-cream">
                    <td className={td}>{p.name}</td>
                    <td className={tdNum}>{sum('web') || ''}</td>
                    <td className={tdNum}>{cell('b2b')}</td>
                    <td className={tdNum}>{cell('manual')}</td>
                    <td className={tdNum}>{cell('extra')}</td>
                    <td className={`${tdNum} font-medium`}>{p.qty}</td>
                    <td className={tdNum}>{fmtG(p.dough_g)} g</td>
                  </tr>
                );
              })}
              {sheet.products.length === 0 && <tr><td className={td} colSpan={7}><span className="text-smitten-text/50">No orders for this day{res.cutoff.passed ? '' : ' yet'}.</span></td></tr>}
            </tbody>
          </table>

          {sheet.stock_products.length > 0 && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">From the freezer</p>
              <ul className="text-sm space-y-1">
                {sheet.stock_products.map((s) => (
                  <li key={s.pr_product_id}>
                    <span className="font-medium">{s.qty} × {s.name}</span>{s.pieces ? ` = ${s.pieces} pieces` : ''}
                    {s.extras && <span className="text-smitten-text/70"> · {s.extras.lines.map((l) => `${l.ingredient_name} ${fmtG(l.total)} g`).join(', ')}</span>}
                    {s.recipe_id && <Link href={`/admin/production/recipes/${s.recipe_id}?batch=1`} className="ml-2 text-xs underline text-smitten-text/60 print:hidden">make batch</Link>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* extra quantities editor */}
          <div className="mt-4 print:hidden border-t border-smitten-cream pt-3">
            <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-2">Extra quantities (freezer stock, B2B, own use)</p>
            {extras.length > 0 && (
              <ul className="text-sm space-y-1 mb-2">
                {extras.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{e.qty} × {products.find((p) => p.id === e.pr_product_id)?.name ?? '?'}{e.reason ? ` (${e.reason})` : ''}</span>
                    <button className="text-xs text-red-700 hover:underline" onClick={() => { setExtras((prev) => prev.filter((_, j) => j !== i)); setDirty(true); }}>remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select className={smallInputCls} value={newExtra.pr_product_id} onChange={(e) => setNewExtra({ ...newExtra, pr_product_id: e.target.value })}>
                <option value="">product…</option>
                {products.filter((p) => p.recipe_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.channel === 'intern' ? ' (internal)' : ''}</option>)}
              </select>
              <input className={`${smallInputCls} w-20`} type="number" min="1" step="1" placeholder="qty" value={newExtra.qty} onChange={(e) => setNewExtra({ ...newExtra, qty: e.target.value })} />
              <input className={`${smallInputCls} w-40`} placeholder="reason" value={newExtra.reason} onChange={(e) => setNewExtra({ ...newExtra, reason: e.target.value })} />
              <button
                className={btnSecondary}
                disabled={!newExtra.pr_product_id || !(Number(newExtra.qty) > 0)}
                onClick={() => { setExtras((prev) => [...prev, { pr_product_id: newExtra.pr_product_id, qty: Number(newExtra.qty), reason: newExtra.reason || null }]); setNewExtra({ pr_product_id: '', qty: '', reason: 'Freezer stock' }); setDirty(true); }}
              >Add</button>
            </div>
          </div>
        </Card>

        {/* B2B and one-off orders */}
        <B2BCard date={date} b2b={res.b2b} products={products} onChanged={() => load()} busy={busy} setBusy={setBusy} />

        {/* Freezer */}
        {res.freezer.length > 0 && (
          <FreezerCard
            date={date} freezer={res.freezer} busy={busy} setBusy={setBusy} onChanged={() => load()}
            bakedToday={(recipeId) => !!recipeId && sheet.recipes.some((r) => r.recipe_id === recipeId)}
            onAddExtra={(pid, qty) => { setExtras((prev) => [...prev, { pr_product_id: pid, qty, reason: 'Freezer stock' }]); setDirty(true); }}
            plannedExtra={(pid) => extras.filter((e) => e.pr_product_id === pid).reduce((n, e) => n + e.qty, 0)}
          />
        )}

        {/* Starter feeding schedule */}
        <Card title="Starter feeding schedule" className="print:border-0 print:p-0 print:mb-4 print:break-inside-avoid">
          {sheet.starters.length === 0 && <p className="text-sm text-smitten-text/50">No starter needed.</p>}
          {sheet.starters.map((s) => (
            <div key={s.starter_id} className="mb-4 last:mb-0">
              <p className="font-medium text-sm mb-1">{s.name} <span className="text-xs text-smitten-text/50">· seed from kept starter {fmtG(s.seed_from_kept_g)} g</span></p>
              <table className="w-full">
                <thead><tr><th className={th}>Stage</th><th className={th}>Day</th><th className={`${th} text-right`}>Flour</th><th className={th}>Flour type</th><th className={`${th} text-right`}>Water</th><th className={`${th} text-right`}>Seed</th><th className={`${th} text-right`}>Total</th></tr></thead>
                <tbody>
                  {[...s.stages].reverse().map((st) => (
                    <StageRows key={st.stage_no} st={st} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      </div>

      {/* Recipes */}
      <div className="space-y-6">
        {sheet.recipes.map((r) => (
          <RecipeCard
            key={r.recipe_id}
            r={r}
            starterInSub={starterInSub}
            adjustments={adjustments}
            frozen={res.frozen && !dirty}
            onAdjust={setAdj}
            onSaveVersion={() => saveAdjustmentAsVersion(r.recipe_id)}
            onReset={() => { setAdjustments((prev) => prev.filter((a) => a.recipe_id !== r.recipe_id)); setDirty(true); }}
            busy={busy}
          />
        ))}
      </div>

      {sheet.totals.eggs > 0 && <p className="mt-6 text-sm text-smitten-text/70">Whole eggs needed today: <span className="font-medium">{sheet.totals.eggs}</span></p>}
    </div>
  );
}

function collectStarterItemIds(b: SubBlock): string[] {
  return [...b.starters.map((s) => s.item_id), ...b.subs.flatMap(collectStarterItemIds)];
}

function StageRows({ st }: { st: BakeSheet['starters'][number]['stages'][number] }) {
  return (
    <>
      <tr className="border-t border-smitten-cream">
        <td className={td}>{st.stage_no === 1 ? 'Last refresh' : `Stage ${st.stage_no}`}</td>
        <td className={td}>{st.date.slice(8, 10)}.{st.date.slice(5, 7)}.</td>
        <td className={`${tdNum} font-medium`}>{fmtG(st.flour_g)}</td>
        <td className={td}>{st.flour_ingredient_name}</td>
        <td className={`${tdNum} font-medium`}>{fmtG(st.water_g)}</td>
        <td className={`${tdNum} font-medium`}>{fmtG(st.seed_g)}</td>
        <td className={tdNum}>{fmtG(st.total_g)}</td>
      </tr>
      {st.per_recipe && st.per_recipe.length > 1 && st.per_recipe.map((pr) => (
        <tr key={pr.recipe_name} className="text-smitten-text/60">
          <td className={`${td} pl-6 text-xs`} colSpan={2}>↳ {pr.recipe_name}</td>
          <td className={`${tdNum} text-xs`}>{fmtG(pr.flour_g)}</td>
          <td className={`${td} text-xs`}>{pr.flour_ingredient_name}</td>
          <td className={`${tdNum} text-xs`}>{fmtG(pr.water_g)}</td>
          <td className={`${tdNum} text-xs`}>{fmtG(pr.seed_g)}</td>
          <td className={`${tdNum} text-xs`}>{fmtG(pr.total_g)}</td>
        </tr>
      ))}
    </>
  );
}

function RecipeCard({ r, starterInSub, adjustments, frozen, onAdjust, onSaveVersion, onReset, busy }: {
  r: RecipeBlock; starterInSub: Set<string>; adjustments: Adjustment[]; frozen: boolean;
  onAdjust: (recipeId: string, itemId: string, pct: string, original: number) => void; onSaveVersion: () => void; onReset: () => void; busy: boolean;
}) {
  const mine = adjustments.filter((a) => a.recipe_id === r.recipe_id);
  const directStarters = r.starters.filter((s) => !starterInSub.has(s.item_id));
  return (
    <Card
      className="print:border-0 print:p-0 print:break-inside-avoid print:mb-6"
      title={<span>{r.name} <span className="text-xs font-normal text-smitten-text/50">v{r.version}</span></span>}
      right={
        <div className="text-right text-sm">
          <p>{r.products.map((p) => `${p.qty}× ${p.name}`).join(' · ')}</p>
          <p className="text-smitten-text/60 text-xs">
            dough {fmtG(r.total_dough_g)} g · Σ {fmtPct(r.sum_pct)} % · margin {r.dough_margin_factor} (+{fmtG(r.margin_g_per_batch)} g/batch) · factor {r.factor.toFixed(4)}
            {r.batches > 1 && <span className="text-amber-700 font-medium"> · {r.batches} batches of {fmtG(r.per_batch_dough_g)} g — figures below are PER BATCH</span>}
          </p>
        </div>
      }
    >
      <table className="w-full">
        <thead><tr><th className={th}>Ingredient</th><th className={`${th} text-right`}>%</th><th className={`${th} text-right`}>g{r.batches > 1 ? ' / batch' : ''}</th><th className={th}></th></tr></thead>
        <tbody>
          {r.lines.map((l) => <Line key={l.item_id} l={l} recipeId={r.recipe_id} frozen={frozen} onAdjust={onAdjust} />)}
          {directStarters.map((s) => <StarterLine key={s.item_id} s={s} />)}
          <tr className="border-t-2 border-smitten-cream font-medium"><td className={td}>Dough total (incl. margin)</td><td className={tdNum}>{fmtPct(r.sum_pct)}</td><td className={tdNum}>{fmtG(r.batch_total_g)}</td><td></td></tr>
        </tbody>
      </table>

      {r.subs.map((b) => <SubCard key={b.recipe_id} b={b} depth={0} />)}

      {(r.per_batch_items.length > 0 || r.eggs_per_batch > 0 || r.extras.length > 0) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {(r.per_batch_items.length > 0 || r.eggs_per_batch > 0) && (
            <div>
              {r.per_batch_items.map((p) => <p key={p.ingredient_id}>Per batch: <span className="font-medium">{p.amount} {p.unit} {p.ingredient_name}</span></p>)}
              {r.eggs_per_batch > 0 && <p>Whole eggs per batch: <span className="font-medium">{r.eggs_per_batch}</span>{r.batches > 1 ? ` (× ${r.batches})` : ''}</p>}
            </div>
          )}
          {r.extras.length > 0 && (
            <div>
              {r.extras.map((e) => (
                <p key={e.pr_product_id}><span className="font-medium">{e.product_name} ×{e.qty}:</span> {e.lines.map((l) => `${l.ingredient_name} ${fmtG(l.total)} g`).join(', ')}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {!frozen && (
        <div className="mt-3 flex flex-wrap items-center gap-3 print:hidden text-xs text-smitten-text/60">
          <span>Change a percentage for this bake day only. The piece weight stays fixed, so every other line shifts slightly.</span>
          {mine.length > 0 && <>
            <button className="underline" onClick={onReset} disabled={busy}>reset today&apos;s changes</button>
            <button className="underline" onClick={onSaveVersion} disabled={busy}>also save as new recipe version</button>
          </>}
        </div>
      )}
    </Card>
  );
}

function Line({ l, recipeId, frozen, onAdjust }: { l: GramLine; recipeId: string; frozen: boolean; onAdjust: (recipeId: string, itemId: string, pct: string, original: number) => void }) {
  return (
    <tr className={`border-t border-smitten-cream ${l.adjusted ? 'bg-amber-50' : ''}`}>
      <td className={td}>{l.label}</td>
      <td className={tdNum}>
        {frozen ? fmtPct(l.pct) : (
          <input
            type="number" step="any" min="0"
            className={`${smallInputCls} w-24 text-right print:hidden`}
            value={l.pct ?? ''}
            onChange={(e) => onAdjust(recipeId, l.item_id!, e.target.value, l.original_pct ?? l.pct ?? 0)}
          />
        )}
        <span className="hidden print:inline">{fmtPct(l.pct)}</span>
        {l.adjusted && <span className="block text-[11px] text-amber-700">was {fmtPct(l.original_pct)}</span>}
      </td>
      <td className={`${tdNum} font-medium`}>{fmtG(l.grams)}</td>
      <td className={`${td} text-xs text-smitten-text/60`}>
        {l.source_units_rounded ? `${l.source_units_rounded} ${l.source_name}${l.byproduct ? ` → ${fmtG(l.byproduct.grams)} g ${l.byproduct.ingredient_name}` : ''}` : ''}
      </td>
    </tr>
  );
}

function StarterLine({ s }: { s: StarterNeed }) {
  return (
    <tr className="border-t border-smitten-cream">
      <td className={td}>{s.label}</td>
      <td className={tdNum}></td>
      <td className={`${tdNum} font-medium`}>{fmtG(s.in_dough_g)}</td>
      <td className={`${td} text-xs text-smitten-text/60`}>final build {fmtG(s.final_build_g)} g = {fmtG(s.flour_g)} {s.flour_ingredient_name} / {fmtG(s.water_g)} water / {fmtG(s.seed_g)} seed</td>
    </tr>
  );
}

function SubCard({ b, depth }: { b: SubBlock; depth: number }) {
  return (
    <div className={`mt-3 rounded-lg border border-smitten-cream p-3 ${depth > 0 ? 'ml-4' : ''} print:break-inside-avoid`}>
      <p className="text-sm font-medium">{b.name} <span className="text-xs font-normal text-smitten-text/60">· needed {fmtG(b.needed_g)} g + {b.build_margin_pct} % = {fmtG(b.total_g)} g · factor {b.factor.toFixed(4)}</span></p>
      <table className="w-full mt-1">
        <tbody>
          {b.lines.map((l) => (
            <tr key={l.item_id} className="border-t border-smitten-cream">
              <td className={td}>{l.label}</td><td className={tdNum}>{fmtPct(l.pct)}</td><td className={`${tdNum} font-medium`}>{fmtG(l.grams)}</td>
              <td className={`${td} text-xs text-smitten-text/60`}>{l.source_units_rounded ? `${l.source_units_rounded} ${l.source_name}` : ''}</td>
            </tr>
          ))}
          {b.starters.map((s) => <StarterLine key={s.item_id} s={s} />)}
        </tbody>
      </table>
      {b.subs.map((c) => <SubCard key={c.recipe_id} b={c} depth={depth + 1} />)}
    </div>
  );
}

function B2BCard({ date, b2b, products, onChanged, busy, setBusy }: {
  date: string; b2b: DayResponse['b2b']; products: ProductionData['products']; onChanged: () => void; busy: boolean; setBusy: (b: boolean) => void;
}) {
  const [editClient, setEditClient] = useState<string | null>(null);
  const [items, setItems] = useState<{ pr_product_id: string; qty: string }[]>([]);
  const [note, setNote] = useState('');
  const [manual, setManual] = useState<{ type: ManualOrder['type']; client_id: string; label: string; items: { pr_product_id: string; qty: string }[] } | null>(null);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const clientName = new Map(b2b.clients.map((c) => [c.id, c.name]));

  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/b2b', { body });
      showToast(okText, 'success');
      setEditClient(null); setManual(null);
      onChanged();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const itemsText = (list: { pr_product_id: string; qty: number }[]) => list.map((i) => `${i.qty} × ${productName.get(i.pr_product_id) ?? '?'}`).join(', ');
  const itemEditor = (list: { pr_product_id: string; qty: string }[], set: (l: { pr_product_id: string; qty: string }[]) => void) => (
    <div>
      {list.map((it, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <input className={`${smallInputCls} w-20`} type="number" min="1" step="1" placeholder="qty" value={it.qty} onChange={(e) => set(list.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
          <select className={smallInputCls} value={it.pr_product_id} onChange={(e) => set(list.map((x, j) => j === i ? { ...x, pr_product_id: e.target.value } : x))}>
            <option value="">product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.production === 'stock' ? ' · from freezer' : ''}</option>)}
          </select>
          <button className="text-xs text-red-700" onClick={() => set(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="text-xs underline text-smitten-text/60" onClick={() => set([...list, { pr_product_id: '', qty: '' }])}>+ item</button>
    </div>
  );

  return (
    <Card title="B2B and one-off orders" className="print:border-0 print:p-0 print:mb-4 print:break-inside-avoid"
      right={<Link href="/admin/production/b2b" className="text-xs underline text-smitten-text/60 print:hidden">clients &amp; standing orders</Link>}>
      {b2b.planned.length === 0 && b2b.manual.length === 0 && <p className="text-sm text-smitten-text/50">No B2B or one-off orders on this day.</p>}
      <ul className="text-sm divide-y divide-smitten-cream">
        {b2b.planned.map((p) => (
          <li key={p.client.id} className="py-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="font-medium">{p.client.name}</span>{' '}
                {p.skipped ? <StatusPill tone="red">closed – nothing today</StatusPill> : p.source === 'override' ? <StatusPill tone="amber">changed for this day</StatusPill> : <StatusPill tone="blue">standing order</StatusPill>}
                {!p.skipped && <span className="block">{itemsText(p.items) || <span className="text-smitten-text/40">nothing</span>}</span>}
                {p.override?.note && <span className="block text-xs text-smitten-text/50">{p.override.note}</span>}
              </div>
              <div className="flex gap-2 print:hidden">
                {editClient !== p.client.id && !p.skipped && <button className="text-xs underline" disabled={busy} onClick={() => { setEditClient(p.client.id); setItems(p.items.map((i) => ({ pr_product_id: i.pr_product_id, qty: String(i.qty) }))); setNote(p.override?.note ?? ''); }}>change today</button>}
                {!p.skipped && <button className="text-xs underline text-red-700" disabled={busy} onClick={() => act({ action: 'save_override', override: { client_id: p.client.id, date, skip: true, note: 'closed' } }, `${p.client.name}: nothing today.`)}>closed today</button>}
                {p.override && <button className="text-xs underline" disabled={busy} onClick={() => act({ action: 'delete_override', client_id: p.client.id, date }, 'Back to the standing order.')}>back to standing order</button>}
              </div>
            </div>
            {editClient === p.client.id && (
              <div className="mt-2 rounded-lg border border-smitten-cream p-3 print:hidden">
                {itemEditor(items, setItems)}
                <input className={`${smallInputCls} w-full mt-2`} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="mt-2 flex gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={() => act({ action: 'save_override', override: { client_id: p.client.id, date, skip: false, items: items.filter((i) => i.pr_product_id).map((i) => ({ pr_product_id: i.pr_product_id, qty: Number(i.qty) })), note } }, `${p.client.name} changed for ${date}.`)}>Save for this day</button>
                  <button className={btnSecondary} onClick={() => setEditClient(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {b2b.manual.map((m) => (
          <li key={m.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="font-medium">{m.type === 'b2b' ? (m.client_id ? clientName.get(m.client_id) ?? 'B2B' : m.label || 'B2B') : `${m.type}${m.label ? ` · ${m.label}` : ''}`}</span> <StatusPill tone="gray">one-off</StatusPill>
              <span className="block">{itemsText(m.items)}</span>
            </div>
            <button className="text-xs underline text-red-700 print:hidden" disabled={busy} onClick={() => { if (confirm('Delete this one-off order?')) act({ action: 'delete_manual', id: m.id }, 'One-off order deleted.'); }}>delete</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 print:hidden">
        {!manual && <button className={btnSecondary} onClick={() => setManual({ type: 'b2b', client_id: b2b.clients[0]?.id ?? '', label: '', items: [{ pr_product_id: '', qty: '' }] })}>+ one-off order</button>}
        {manual && (
          <div className="rounded-lg border border-smitten-cream p-3">
            <div className="flex flex-wrap gap-2 mb-2">
              <select className={smallInputCls} value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value as ManualOrder['type'] })}>
                <option value="b2b">B2B</option><option value="market">market</option><option value="test">test bake</option><option value="own">own use</option>
              </select>
              {manual.type === 'b2b' && (
                <select className={smallInputCls} value={manual.client_id} onChange={(e) => setManual({ ...manual, client_id: e.target.value })}>
                  <option value="">client…</option>{b2b.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <input className={`${smallInputCls} w-48`} placeholder="label (optional)" value={manual.label} onChange={(e) => setManual({ ...manual, label: e.target.value })} />
            </div>
            {itemEditor(manual.items, (l) => setManual({ ...manual, items: l }))}
            <div className="mt-2 flex gap-2">
              <button className={btnPrimary} disabled={busy} onClick={() => act({ action: 'save_manual', manual: { date, type: manual.type, client_id: manual.client_id || null, label: manual.label, items: manual.items.filter((i) => i.pr_product_id).map((i) => ({ pr_product_id: i.pr_product_id, qty: Number(i.qty) })) } }, 'One-off order saved.')}>Save</button>
              <button className={btnSecondary} onClick={() => setManual(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function FreezerCard({ date, freezer, busy, setBusy, onChanged, onAddExtra, plannedExtra, bakedToday }: {
  date: string; freezer: FreezerStatus[]; busy: boolean; setBusy: (b: boolean) => void; onChanged: () => void;
  onAddExtra: (pid: string, qty: number) => void; plannedExtra: (pid: string) => number; bakedToday: (recipeId: string | null) => boolean;
}) {
  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try { await adminFetch('/api/admin/production/freezer', { body }); showToast(okText, 'success'); onChanged(); }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="Freezer" className="print:border-0 print:p-0 print:mb-4 print:break-inside-avoid"
      right={<Link href="/admin/production/freezer" className="text-xs underline text-smitten-text/60 print:hidden">stock &amp; ledger</Link>}>
      <table className="w-full">
        <thead><tr><th className={th}>Product</th><th className={`${th} text-right`}>In stock</th><th className={`${th} text-right`}>Out today</th><th className={`${th} text-right`}>Made today</th><th className={`${th} text-right`}>Then</th><th className={th}>Coming up</th><th className={th}></th></tr></thead>
        <tbody>
          {freezer.map((f) => {
            const planned = plannedExtra(f.pr_product_id) * f.pieces_per_unit;
            const unconfirmed = planned > 0 && f.batch_today !== planned;
            return (
              <tr key={f.pr_product_id} className="border-t border-smitten-cream">
                <td className={td}>{f.name}{f.too_old && <span className="block text-xs text-red-700">oldest batch {f.oldest_batch_age_days} days</span>}</td>
                <td className={tdNum}>{f.counter}</td>
                <td className={tdNum}>{f.usage_today ? `−${f.usage_today}` : ''}</td>
                <td className={tdNum}>
                  {f.batch_today ? <span className="text-green-700">+{f.batch_today}</span> : planned ? <span className="text-amber-700">{planned} planned</span> : ''}
                </td>
                <td className={`${tdNum} font-medium`}>{f.after_today}</td>
                <td className={`${td} text-xs`}>
                  {f.ahead.map((a) => <span key={a.date} className="block">{a.date.slice(8, 10)}.{a.date.slice(5, 7)}. −{a.pieces} <span className="text-smitten-text/50">{a.who}</span></span>)}
                  <span className={`block ${f.projected < f.settings.min_level ? 'text-red-700 font-medium' : 'text-smitten-text/60'}`}>→ {f.projected} left (min {f.settings.min_level})</span>
                  {f.suggestion > 0 && (bakedToday(f.recipe_id)
                    ? <span className="block text-red-700 font-medium">Make {f.suggestion} today</span>
                    : <span className="block text-amber-700 font-medium">Make {f.suggestion} at the next bake of this dough</span>)}
                </td>
                <td className={`${td} text-right whitespace-nowrap print:hidden`}>
                  {f.suggestion > 0 && planned === 0 && bakedToday(f.recipe_id) && <button className="text-xs underline mr-2" onClick={() => onAddExtra(f.pr_product_id, Math.ceil(f.suggestion / f.pieces_per_unit))}>add {Math.ceil(f.suggestion / f.pieces_per_unit)} extra</button>}
                  {planned > 0 && unconfirmed && <button className="text-xs underline mr-2 text-green-700" disabled={busy} onClick={() => act({ action: 'book_batch', pr_product_id: f.pr_product_id, date, qty: planned }, `${f.name}: +${planned} booked.`)}>confirm made {planned}</button>}
                  {f.batch_today > 0 && <button className="text-xs underline text-smitten-text/60" disabled={busy} onClick={() => act({ action: 'unbook_batch', pr_product_id: f.pr_product_id, date }, 'Batch booking removed.')}>undo</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-smitten-text/50 mt-2 print:hidden">Usage is booked automatically once the bake day is over. “Confirm made” books the batch you actually put in the freezer; unsaved extra quantities must be saved with “Save day”.</p>
    </Card>
  );
}
