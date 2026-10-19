'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary, btnDanger, smallInputCls, th, td } from '@/components/admin/production/ui';
import { adminFetch, loadData } from '@/lib/production/client';
import { WEEKDAYS, rangeHasWeekday } from '@/lib/production/b2b';
import { BAKE_WEEKDAYS, formatDateEN, isBakeDay, upcomingBakeDays } from '@/lib/production/bakeDays';
import type { B2BClient, ManualOrder, OrderItem, ProductionData, StandingOrder } from '@/lib/production/types';

interface B2BResponse {
  clients: B2BClient[];
  standing: StandingOrder[];
  upcoming_manual: ManualOrder[];
  upcoming_overrides: { id: string; client_id: string; date: string; skip: boolean; items: OrderItem[] | null; note: string | null }[];
}

type ItemRow = { pr_product_id: string; qty: string };
type StandingForm = { client_id: string; weekday: number; items: ItemRow[]; valid_from: string; valid_to: string; active: boolean; notes: string };
type SingleForm = { id?: string; client_id: string; date: string; items: ItemRow[]; notes: string };

const toItems = (rows: ItemRow[]): OrderItem[] => rows.filter((i) => i.pr_product_id).map((i) => ({ pr_product_id: i.pr_product_id, qty: Number(i.qty) }));
const fromItems = (items: OrderItem[]): ItemRow[] => items.map((i) => ({ pr_product_id: i.pr_product_id, qty: String(i.qty) }));

function ItemsEditor({ rows, set, products }: { rows: ItemRow[]; set: (r: ItemRow[]) => void; products: ProductionData['products'] }) {
  return (
    <div>
      <p className="text-[11px] text-smitten-text/60 mb-1">Items</p>
      {rows.map((it, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <input className={`${smallInputCls} w-20`} type="number" min="1" step="1" placeholder="qty" value={it.qty} onChange={(e) => set(rows.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
          <select className={smallInputCls} value={it.pr_product_id} onChange={(e) => set(rows.map((x, j) => j === i ? { ...x, pr_product_id: e.target.value } : x))}>
            <option value="">product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.channel === 'intern' ? ' (internal)' : ''}{p.production === 'stock' ? ' · from freezer' : ''}</option>)}
          </select>
          <button className="text-xs text-red-700" onClick={() => set(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className={btnSecondary} onClick={() => set([...rows, { pr_product_id: '', qty: '' }])}>+ item</button>
    </div>
  );
}

export default function B2BPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [b2b, setB2B] = useState<B2BResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientForm, setClientForm] = useState<{ id?: string; name: string; notes: string; active: boolean } | null>(null);
  const [standingForm, setStandingForm] = useState<StandingForm | null>(null);
  const [singleForm, setSingleForm] = useState<SingleForm | null>(null);

  const load = async () => {
    try {
      const [d, r] = await Promise.all([loadData(), adminFetch<B2BResponse>('/api/admin/production/b2b')]);
      setData(d); setB2B(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      await adminFetch('/api/admin/production/b2b', { body });
      showToast(okText, 'success');
      setClientForm(null); setStandingForm(null); setSingleForm(null);
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data || !b2b) return <AdminLoading what="B2B" />;

  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const clientName = new Map(b2b.clients.map((c) => [c.id, c.name]));
  const itemsText = (items: OrderItem[] | null) => (items ?? []).map((i) => `${i.qty} × ${productName.get(i.pr_product_id) ?? '?'}`).join(', ');
  const bakeDayOptions = upcomingBakeDays(16);
  const singles = b2b.upcoming_manual.filter((m) => m.type === 'b2b' && m.client_id);
  const otherManual = b2b.upcoming_manual.filter((m) => !(m.type === 'b2b' && m.client_id));
  const saveSingle = (f: SingleForm) => act({ action: 'save_manual', manual: { id: f.id, date: f.date, type: 'b2b', client_id: f.client_id, items: toItems(f.items), notes: f.notes } }, 'Single order saved.');

  return (
    <div>
      <PageHeader
        title="B2B clients"
        subtitle="Standing orders per weekday are planned automatically on every matching bake day. A single order is for one bake day only (a new client's one-time order, or extras for a regular client). Changes to a standing order on one day (more, less, closed) are made on that day's bake sheet."
        actions={<button className={btnPrimary} onClick={() => setClientForm({ name: '', notes: '', active: true })}>New client</button>}
      />
      <SubNav current="/admin/production/b2b" />

      {clientForm && (
        <Card title={clientForm.id ? `Edit ${clientForm.name}` : 'New client'} className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Name</span><input className={`${smallInputCls} w-full`} value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} /></label>
            <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Notes (delivery time, contact …)</span><input className={`${smallInputCls} w-full`} value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} /></label>
            <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={clientForm.active} onChange={(e) => setClientForm({ ...clientForm, active: e.target.checked })} /> active (inactive = nothing is planned)</label>
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btnPrimary} disabled={busy || !clientForm.name.trim()} onClick={() => act({ action: 'save_client', client: clientForm }, 'Client saved.')}>Save</button>
            <button className={btnSecondary} onClick={() => setClientForm(null)}>Cancel</button>
          </div>
        </Card>
      )}

      {b2b.clients.length === 0 && <Notice tone="info">No B2B clients yet. Create one (e.g. Lumbono), then add its standing orders per weekday.</Notice>}

      {b2b.clients.map((c) => {
        const mine = b2b.standing.filter((s) => s.client_id === c.id).sort((a, b) => a.weekday - b.weekday);
        return (
          <Card key={c.id} className="mb-6" title={<span>{c.name} {!c.active && <StatusPill tone="gray">inactive</StatusPill>}{c.notes && <span className="text-xs font-normal text-smitten-text/50"> · {c.notes}</span>}</span>}
            right={<div className="flex gap-2">
              <button className="text-sm text-smitten-text/70 hover:text-smitten-primary" onClick={() => setClientForm({ id: c.id, name: c.name, notes: c.notes ?? '', active: c.active })}>edit</button>
              <button className={btnDanger} onClick={() => { if (confirm(`Delete client "${c.name}" and all its standing orders?`)) act({ action: 'delete_client', id: c.id }, 'Client deleted.'); }}>delete</button>
            </div>}>
            <table className="w-full">
              <thead><tr><th className={th}>Weekday</th><th className={th}>Items</th><th className={th}>Valid</th><th className={th}></th></tr></thead>
              <tbody>
                {mine.map((s) => (
                  <tr key={s.id} className="border-t border-smitten-cream">
                    <td className={td}>{WEEKDAYS[s.weekday]} {!BAKE_WEEKDAYS.some((b) => b.weekday === s.weekday) && <StatusPill tone="amber">not a bake day</StatusPill>} {!s.active && <StatusPill tone="gray">paused</StatusPill>}</td>
                    <td className={td}>{itemsText(s.items) || <span className="text-smitten-text/40">nothing</span>}{s.notes && <span className="block text-xs text-smitten-text/50">{s.notes}</span>}</td>
                    <td className={`${td} text-xs text-smitten-text/60`}>{s.valid_from || s.valid_to ? `${s.valid_from ?? '…'} – ${s.valid_to ?? '…'}` : 'always'}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button className="text-sm text-smitten-text/70 hover:text-smitten-primary mr-2" onClick={() => setStandingForm({ client_id: c.id, weekday: s.weekday, items: fromItems(s.items), valid_from: s.valid_from ?? '', valid_to: s.valid_to ?? '', active: s.active, notes: s.notes ?? '' })}>edit</button>
                      <button className={btnDanger} onClick={() => { if (confirm(`Delete the ${WEEKDAYS[s.weekday]} standing order of ${c.name}?`)) act({ action: 'delete_standing', id: s.id }, 'Standing order deleted.'); }}>delete</button>
                    </td>
                  </tr>
                ))}
                {mine.length === 0 && <tr><td className={td} colSpan={4}><span className="text-smitten-text/50">No standing orders.</span></td></tr>}
              </tbody>
            </table>
            <div className="mt-3">
              <button className={btnSecondary} onClick={() => setStandingForm({ client_id: c.id, weekday: BAKE_WEEKDAYS.find((b) => !mine.some((s) => s.weekday === b.weekday))?.weekday ?? 3, items: [{ pr_product_id: '', qty: '' }], valid_from: '', valid_to: '', active: true, notes: '' })}>+ standing order</button>
            </div>

            {standingForm && standingForm.client_id === c.id && (
              <div className="mt-4 rounded-lg border border-smitten-cream p-4">
                <p className="text-sm font-medium mb-2">Standing order · {c.name}</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Weekday</span>
                    <select className={`${smallInputCls} w-full`} value={standingForm.weekday} onChange={(e) => setStandingForm({ ...standingForm, weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}{BAKE_WEEKDAYS.some((b) => b.weekday === i) ? ' (bake day)' : ''}</option>)}
                    </select></label>
                  <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Valid from (optional)</span><input type="date" className={`${smallInputCls} w-full`} value={standingForm.valid_from} onChange={(e) => setStandingForm({ ...standingForm, valid_from: e.target.value })} /></label>
                  <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Valid to (optional)</span><input type="date" className={`${smallInputCls} w-full`} value={standingForm.valid_to} onChange={(e) => setStandingForm({ ...standingForm, valid_to: e.target.value })} /></label>
                  <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={standingForm.active} onChange={(e) => setStandingForm({ ...standingForm, active: e.target.checked })} /> active</label>
                </div>
                {standingForm.valid_from && standingForm.valid_to && !rangeHasWeekday(standingForm.weekday, standingForm.valid_from, standingForm.valid_to) && (
                  <div className="mt-3"><Notice tone="error">This window contains no {WEEKDAYS[standingForm.weekday]}, so nothing would ever be planned. For one delivery use “+ single order” below instead.</Notice></div>
                )}
                <div className="mt-3"><ItemsEditor rows={standingForm.items} set={(items) => setStandingForm({ ...standingForm, items })} products={data.products} /></div>
                <label className="block mt-3"><span className="block text-[11px] text-smitten-text/60 mb-1">Notes</span><input className={`${smallInputCls} w-full md:w-1/2`} value={standingForm.notes} onChange={(e) => setStandingForm({ ...standingForm, notes: e.target.value })} /></label>
                <div className="mt-3 flex gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={() => act({ action: 'save_standing', standing: { ...standingForm, items: toItems(standingForm.items) } }, 'Standing order saved.')}>Save</button>
                  <button className={btnSecondary} onClick={() => setStandingForm(null)}>Cancel</button>
                </div>
              </div>
            )}

            {(() => {
              const mine = singles.filter((m) => m.client_id === c.id);
              return (
                <div className="mt-5 pt-4 border-t border-smitten-cream">
                  <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-2">Single orders (one bake day only)</p>
                  {mine.length === 0 && <p className="text-sm text-smitten-text/50">No upcoming single orders.</p>}
                  <ul className="text-sm divide-y divide-smitten-cream">
                    {mine.map((m) => (
                      <li key={m.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                        <span><Link href={`/admin/production/bake-day/${m.date}`} className="underline">{formatDateEN(m.date)}</Link>: {itemsText(m.items)}{m.notes && <span className="block text-xs text-smitten-text/50">{m.notes}</span>}</span>
                        <span className="whitespace-nowrap">
                          <button className="text-sm text-smitten-text/70 hover:text-smitten-primary mr-2" onClick={() => setSingleForm({ id: m.id, client_id: c.id, date: m.date, items: fromItems(m.items), notes: m.notes ?? '' })}>edit</button>
                          <button className={btnDanger} onClick={() => { if (confirm(`Delete the single order of ${c.name} on ${formatDateEN(m.date)}?`)) act({ action: 'delete_manual', id: m.id }, 'Single order deleted.'); }}>delete</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <button className={btnSecondary} onClick={() => setSingleForm({ client_id: c.id, date: bakeDayOptions[0], items: [{ pr_product_id: '', qty: '' }], notes: '' })}>+ single order</button>
                  </div>
                  {singleForm && singleForm.client_id === c.id && (
                    <div className="mt-4 rounded-lg border border-smitten-cream p-4">
                      <p className="text-sm font-medium mb-2">{singleForm.id ? 'Edit single order' : 'Single order'} · {c.name}</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Bake day</span>
                          <select className={`${smallInputCls} w-full`} value={bakeDayOptions.includes(singleForm.date) ? singleForm.date : 'other'} onChange={(e) => setSingleForm({ ...singleForm, date: e.target.value === 'other' ? '' : e.target.value })}>
                            {bakeDayOptions.map((d) => <option key={d} value={d}>{formatDateEN(d)}</option>)}
                            <option value="other">later date…</option>
                          </select></label>
                        {!bakeDayOptions.includes(singleForm.date) && (
                          <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">Date (Wednesday or Saturday)</span><input type="date" className={`${smallInputCls} w-full`} value={singleForm.date} onChange={(e) => setSingleForm({ ...singleForm, date: e.target.value })} /></label>
                        )}
                        <label className="block md:col-span-1"><span className="block text-[11px] text-smitten-text/60 mb-1">Notes (delivery day, occasion …)</span><input className={`${smallInputCls} w-full`} value={singleForm.notes} onChange={(e) => setSingleForm({ ...singleForm, notes: e.target.value })} /></label>
                      </div>
                      {singleForm.date && !isBakeDay(singleForm.date) && <div className="mt-3"><Notice tone="error">{formatDateEN(singleForm.date)} is not a bake day. Choose the Wednesday or Saturday you bake it and put the delivery day in the notes.</Notice></div>}
                      <div className="mt-3"><ItemsEditor rows={singleForm.items} set={(items) => setSingleForm({ ...singleForm, items })} products={data.products} /></div>
                      <div className="mt-3 flex gap-2">
                        <button className={btnPrimary} disabled={busy || !singleForm.date || !isBakeDay(singleForm.date) || toItems(singleForm.items).length === 0} onClick={() => saveSingle(singleForm)}>Save</button>
                        <button className={btnSecondary} onClick={() => setSingleForm(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
        );
      })}

      {(b2b.upcoming_overrides.length > 0 || otherManual.length > 0) && (
        <Card title="Upcoming changes to standing orders and other one-off bakes">
          <ul className="text-sm divide-y divide-smitten-cream">
            {b2b.upcoming_overrides.map((o) => (
              <li key={o.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                <span><Link href={`/admin/production/bake-day/${o.date}`} className="underline">{formatDateEN(o.date)}</Link> · {clientName.get(o.client_id) ?? '?'}: {o.skip ? <StatusPill tone="red">closed / nothing</StatusPill> : itemsText(o.items)}{o.note ? ` (${o.note})` : ''}</span>
                <button className="text-xs text-red-700" onClick={() => act({ action: 'delete_override', client_id: o.client_id, date: o.date }, 'Back to the standing order.')}>remove change</button>
              </li>
            ))}
            {otherManual.map((m) => (
              <li key={m.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                <span><Link href={`/admin/production/bake-day/${m.date}`} className="underline">{formatDateEN(m.date)}</Link> · one-off {m.type}{m.label ? ` "${m.label}"` : ''}: {itemsText(m.items)}{m.notes ? ` (${m.notes})` : ''}</span>
                <button className="text-xs text-red-700" onClick={() => act({ action: 'delete_manual', id: m.id }, 'One-off order deleted.')}>delete</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
