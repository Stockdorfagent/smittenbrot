'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch } from '@/lib/production/client';
import type { FreezerMovement, FreezerSettings, FreezerStatus } from '@/lib/production/freezer';

interface FreezerResponse { date: string; status: FreezerStatus[]; movements: FreezerMovement[]; settings: FreezerSettings[] }

export default function FreezerPage() {
  const [res, setRes] = useState<FreezerResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, { batch_size: string; min_level: string; max_age_days: string }>>({});
  const [countForm, setCountForm] = useState<Record<string, string>>({});
  const [manualForm, setManualForm] = useState<{ pid: string; qty: string; note: string } | null>(null);

  const load = async () => {
    try {
      const r = await adminFetch<FreezerResponse>('/api/admin/production/freezer');
      setRes(r);
      const f: typeof settingsForm = {};
      for (const s of r.status) f[s.pr_product_id] = { batch_size: String(s.settings.batch_size), min_level: String(s.settings.min_level), max_age_days: s.settings.max_age_days?.toString() ?? '' };
      setSettingsForm(f);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try { await adminFetch('/api/admin/production/freezer', { body }); showToast(okText, 'success'); setManualForm(null); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!res) return <AdminLoading what="freezer" />;

  const name = new Map(res.status.map((s) => [s.pr_product_id, s.name]));

  return (
    <div>
      <PageHeader title="Freezer stock" subtitle={`Stock products (made in batches, delivered from the freezer). Figures in pieces, as of today ${res.date}. Batches are confirmed on the bake sheet; usage is booked automatically when a bake day is over.`} />
      <SubNav current="/admin/production/freezer" />

      {res.status.length === 0 && <Notice tone="info">No stock products. Set a product to production = stock on the <Link href="/admin/production/products" className="underline">Products</Link> page.</Notice>}

      {res.status.map((s) => (
        <Card key={s.pr_product_id} className="mb-6" title={<span>{s.name} {s.too_old && <StatusPill tone="red">oldest batch {s.oldest_batch_age_days} days</StatusPill>}</span>}
          right={<span className="text-2xl font-display font-bold">{s.after_today} <span className="text-sm font-normal text-smitten-text/50">pieces{s.pieces_per_unit > 1 ? ` (${s.pieces_per_unit} per unit)` : ''}</span></span>}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">Outlook</p>
              {s.ahead.length === 0 ? <p className="text-smitten-text/60">No deliveries planned on the next two bake days.</p> : (
                <ul>{s.ahead.map((a) => <li key={a.date}>{a.date}: −{a.pieces} <span className="text-smitten-text/50">({a.who})</span></li>)}</ul>
              )}
              <p className="mt-1">Projected: <span className={`font-medium ${s.projected < s.settings.min_level ? 'text-red-700 dark:text-red-400' : ''}`}>{s.projected}</span> (minimum {s.settings.min_level})</p>
              {s.suggestion > 0 && <p className="text-red-700 dark:text-red-400 font-medium">Make {s.suggestion} pieces at the next opportunity.</p>}
              {s.oldest_batch_date && <p className="text-xs text-smitten-text/50 mt-1">Oldest batch in stock: {s.oldest_batch_date} ({s.oldest_batch_age_days} days)</p>}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">Settings</p>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="block"><span className="block text-[11px] text-smitten-text/60">batch size</span><input className={`${smallInputCls} w-20`} type="number" min="1" step="any" value={settingsForm[s.pr_product_id]?.batch_size ?? ''} onChange={(e) => setSettingsForm({ ...settingsForm, [s.pr_product_id]: { ...settingsForm[s.pr_product_id], batch_size: e.target.value } })} /></label>
                <label className="block"><span className="block text-[11px] text-smitten-text/60">min level</span><input className={`${smallInputCls} w-20`} type="number" min="0" step="any" value={settingsForm[s.pr_product_id]?.min_level ?? ''} onChange={(e) => setSettingsForm({ ...settingsForm, [s.pr_product_id]: { ...settingsForm[s.pr_product_id], min_level: e.target.value } })} /></label>
                <label className="block"><span className="block text-[11px] text-smitten-text/60">max age (days)</span><input className={`${smallInputCls} w-20`} type="number" min="1" step="1" value={settingsForm[s.pr_product_id]?.max_age_days ?? ''} onChange={(e) => setSettingsForm({ ...settingsForm, [s.pr_product_id]: { ...settingsForm[s.pr_product_id], max_age_days: e.target.value } })} /></label>
                <button className={btnSecondary} disabled={busy} onClick={() => act({ action: 'save_settings', pr_product_id: s.pr_product_id, ...settingsForm[s.pr_product_id] }, 'Settings saved.')}>Save</button>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">Stock count / correction</p>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="block"><span className="block text-[11px] text-smitten-text/60">counted pieces</span><input className={`${smallInputCls} w-24`} type="number" min="0" step="1" value={countForm[s.pr_product_id] ?? ''} onChange={(e) => setCountForm({ ...countForm, [s.pr_product_id]: e.target.value })} /></label>
                <button className={btnSecondary} disabled={busy || countForm[s.pr_product_id] === undefined || countForm[s.pr_product_id] === ''} onClick={() => act({ action: 'set_count', pr_product_id: s.pr_product_id, counted: Number(countForm[s.pr_product_id]) }, 'Count booked.')}>Set count</button>
                <button className="text-xs underline text-smitten-text/60" onClick={() => setManualForm({ pid: s.pr_product_id, qty: '', note: '' })}>± manual</button>
              </div>
              {manualForm?.pid === s.pr_product_id && (
                <div className="mt-2 flex flex-wrap gap-2 items-end">
                  <input className={`${smallInputCls} w-24`} type="number" step="1" placeholder="+6 / −3" value={manualForm.qty} onChange={(e) => setManualForm({ ...manualForm, qty: e.target.value })} />
                  <input className={`${smallInputCls} w-40`} placeholder="note (e.g. discarded)" value={manualForm.note} onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })} />
                  <button className={btnPrimary} disabled={busy || !Number(manualForm.qty)} onClick={() => act({ action: 'manual', pr_product_id: s.pr_product_id, qty: Number(manualForm.qty), note: manualForm.note }, 'Booked.')}>Book</button>
                  <button className={btnSecondary} onClick={() => setManualForm(null)}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}

      {res.movements.length > 0 && (
        <Card title="Ledger">
          <table className="w-full">
            <thead><tr><th className={th}>Date</th><th className={th}>Product</th><th className={th}>Kind</th><th className={`${th} text-right`}>Pieces</th><th className={th}>Note</th><th className={th}></th></tr></thead>
            <tbody>
              {[...res.movements].reverse().map((m) => (
                <tr key={m.id} className="border-t border-smitten-cream">
                  <td className={td}>{m.date}</td><td className={td}>{name.get(m.pr_product_id) ?? '?'}</td><td className={td}>{m.kind}</td>
                  <td className={`${tdNum} ${m.qty < 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  <td className={`${td} text-xs text-smitten-text/60`}>{m.note}</td>
                  <td className={`${td} text-right`}>{(m.kind === 'count' || m.kind === 'manual') && <button className="text-xs text-red-700 dark:text-red-400" disabled={busy} onClick={() => { if (confirm('Delete this booking?')) act({ action: 'delete_movement', id: m.id }, 'Deleted.'); }}>delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
