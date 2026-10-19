'use client';

import { useEffect, useState } from 'react';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { showToast } from '@/components/admin/toast';
import { Card, Field, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, btnDanger, inputCls, smallInputCls, th, td } from '@/components/admin/production/ui';
import { adminFetch, loadData } from '@/lib/production/client';
import { BAKE_WEEKDAYS, CUTOFF_DAYS_BEFORE, CUTOFF_HOUR } from '@/lib/production/bakeDays';
import type { ProductionData, Starter, StarterStage } from '@/lib/production/types';

type StarterForm = { id?: string; name: string; maintenance_flour_ingredient_id: string; stages: StarterStage[] };

export default function ProductionSettingsPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState('');
  const [defaults, setDefaults] = useState({ dough_margin_factor: '', build_margin_pct: '', final_build_margin_pct: '' });
  const [starter, setStarter] = useState<StarterForm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => loadData().then((d) => {
    setData(d);
    setDefaults({ dough_margin_factor: String(d.settings.dough_margin_factor), build_margin_pct: String(d.settings.build_margin_pct), final_build_margin_pct: String(d.settings.final_build_margin_pct) });
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function saveDefaults() {
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/settings', { body: defaults });
      showToast('Defaults saved.', 'success');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function saveStarter() {
    if (!starter) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/starters', { body: { starter } });
      showToast('Starter saved.', 'success');
      setStarter(null);
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function removeStarter(s: Starter) {
    if (!confirm(`Delete starter "${s.name}"?`)) return;
    try {
      await adminFetch('/api/admin/production/starters', { method: 'DELETE', body: { id: s.id } });
      showToast('Deleted.', 'success');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <AdminLoading what="settings" />;

  const ingName = new Map(data.ingredients.map((i) => [i.id, i.name]));

  return (
    <div>
      <PageHeader title="Production settings" subtitle="Margin defaults, starters and their feeding stages. Bake days follow the shop." />
      <SubNav current="/admin/production/settings" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Shop bake days and cut-offs">
          <p className="text-sm text-smitten-text/70 mb-2">Shop days are derived from the shop&apos;s pickup rule, not set here: a shop bake day is a pickup day, its cut-off is {CUTOFF_DAYS_BEFORE} days before at {String(CUTOFF_HOUR).padStart(2, '0')}:00 Berlin. B2B orders are delivered and can fall on any weekday — every date with B2B work gets its own bake sheet.</p>
          <ul className="text-sm">
            {BAKE_WEEKDAYS.map((b) => <li key={b.weekday} className="py-1">{b.label}</li>)}
          </ul>
          <p className="text-xs text-smitten-text/50 mt-2">Changing a bake day (e.g. Saturday → Sunday) is a shop-wide change: pickup logic, product availability, subscriptions and the Abo crons. Do it there first; this module follows.</p>
        </Card>

        <Card title="Margin defaults">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Dough margin factor" hint="Used by dough recipes without their own value. Adds factor × Σ% grams of dough per batch.">
              <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={defaults.dough_margin_factor} onChange={(e) => setDefaults({ ...defaults, dough_margin_factor: e.target.value })} />
            </Field>
            <Field label="Build margin % (sub-recipes)" hint="Used by sub-recipes without their own value.">
              <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={defaults.build_margin_pct} onChange={(e) => setDefaults({ ...defaults, build_margin_pct: e.target.value })} />
            </Field>
            <Field label="Final build margin % (starters)" hint="On the last refresh of every starter: needed × (1 + this).">
              <input className={`${inputCls} w-full`} type="number" step="any" min="0" value={defaults.final_build_margin_pct} onChange={(e) => setDefaults({ ...defaults, final_build_margin_pct: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3"><button className={btnPrimary} onClick={saveDefaults} disabled={busy}>Save defaults</button></div>
        </Card>
      </div>

      <Card title="Starters" className="mt-6" right={<button className={btnSecondary} onClick={() => setStarter({ name: '', maintenance_flour_ingredient_id: '', stages: [
        { stage_no: 1, day_offset: -1, flour_parts: 2, water_parts: 1, seed_parts: 1, flour_from_recipe: true },
        { stage_no: 2, day_offset: -2, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
        { stage_no: 3, day_offset: -3, flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false },
      ] })}>New starter</button>}>
        <p className="text-xs text-smitten-text/50 mb-3">Stages are listed last refresh first (stage 1 = the day before the bake). Ratio parts flour : water : seed. &ldquo;Flour from recipe&rdquo; means the last refresh uses the flour named on the recipe line; otherwise the maintenance flour.</p>
        {data.starters.map((s) => (
          <div key={s.id} className="border-t border-smitten-cream py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{s.name} <span className="text-xs font-normal text-smitten-text/50">· maintenance flour {s.maintenance_flour_ingredient_id ? ingName.get(s.maintenance_flour_ingredient_id) : '—'}</span></p>
              <div>
                <button className="text-sm text-smitten-text/70 hover:text-smitten-primary mr-2" onClick={() => setStarter({ id: s.id, name: s.name, maintenance_flour_ingredient_id: s.maintenance_flour_ingredient_id ?? '', stages: s.stages.map((st) => ({ ...st })) })}>edit</button>
                <button className={btnDanger} onClick={() => removeStarter(s)}>delete</button>
              </div>
            </div>
            <table className="mt-1">
              <thead><tr><th className={th}>Stage</th><th className={th}>Day offset</th><th className={th}>Flour</th><th className={th}>Water</th><th className={th}>Seed</th><th className={th}>Flour from recipe</th></tr></thead>
              <tbody>
                {s.stages.map((st) => <tr key={st.stage_no}><td className={td}>{st.stage_no === 1 ? 'last refresh' : st.stage_no}</td><td className={td}>{st.day_offset}</td><td className={td}>{st.flour_parts}</td><td className={td}>{st.water_parts}</td><td className={td}>{st.seed_parts}</td><td className={td}>{st.flour_from_recipe ? 'yes' : 'no'}</td></tr>)}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      {starter && (
        <Card title={starter.id ? `Edit ${starter.name}` : 'New starter'} className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name"><input className={`${inputCls} w-full`} value={starter.name} onChange={(e) => setStarter({ ...starter, name: e.target.value })} /></Field>
            <Field label="Maintenance flour">
              <select className={`${inputCls} w-full`} value={starter.maintenance_flour_ingredient_id} onChange={(e) => setStarter({ ...starter, maintenance_flour_ingredient_id: e.target.value })}>
                <option value="">—</option>{data.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
          </div>
          <table className="mt-3">
            <thead><tr><th className={th}>Stage</th><th className={th}>Day offset</th><th className={th}>Flour</th><th className={th}>Water</th><th className={th}>Seed</th><th className={th}>Flour from recipe</th><th></th></tr></thead>
            <tbody>
              {starter.stages.map((st, i) => (
                <tr key={i}>
                  <td className={td}>{i === 0 ? 'last refresh' : i + 1}</td>
                  <td className={td}><input className={`${smallInputCls} w-16`} type="number" step="1" max="0" value={st.day_offset} onChange={(e) => setStarter({ ...starter, stages: starter.stages.map((x, j) => j === i ? { ...x, day_offset: Number(e.target.value) } : x) })} /></td>
                  <td className={td}><input className={`${smallInputCls} w-16`} type="number" step="any" value={st.flour_parts} onChange={(e) => setStarter({ ...starter, stages: starter.stages.map((x, j) => j === i ? { ...x, flour_parts: Number(e.target.value) } : x) })} /></td>
                  <td className={td}><input className={`${smallInputCls} w-16`} type="number" step="any" value={st.water_parts} onChange={(e) => setStarter({ ...starter, stages: starter.stages.map((x, j) => j === i ? { ...x, water_parts: Number(e.target.value) } : x) })} /></td>
                  <td className={td}><input className={`${smallInputCls} w-16`} type="number" step="any" value={st.seed_parts} onChange={(e) => setStarter({ ...starter, stages: starter.stages.map((x, j) => j === i ? { ...x, seed_parts: Number(e.target.value) } : x) })} /></td>
                  <td className={td}><input type="checkbox" checked={st.flour_from_recipe} onChange={(e) => setStarter({ ...starter, stages: starter.stages.map((x, j) => j === i ? { ...x, flour_from_recipe: e.target.checked } : x) })} /></td>
                  <td className={td}><button className="text-xs text-red-700" onClick={() => setStarter({ ...starter, stages: starter.stages.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button className={btnSecondary} onClick={() => setStarter({ ...starter, stages: [...starter.stages, { stage_no: starter.stages.length + 1, day_offset: -(starter.stages.length + 1), flour_parts: 2, water_parts: 2, seed_parts: 1, flour_from_recipe: false }] })}>+ stage</button>
            <button className={btnPrimary} onClick={saveStarter} disabled={busy || !starter.name.trim() || starter.stages.length === 0}>Save starter</button>
            <button className={btnSecondary} onClick={() => setStarter(null)}>Cancel</button>
          </div>
        </Card>
      )}
    </div>
  );
}
