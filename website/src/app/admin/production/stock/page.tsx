'use client';

import { useEffect, useState } from 'react';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnDanger, btnPrimary, btnSecondary, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, fmtG, loadData } from '@/lib/production/client';
import { parseEuro, type StockRow } from '@/lib/production/stock';
import type { Delivery, Ingredient, LedgerRow, ProductionData, Supplier, SupplierItem } from '@/lib/production/types';

interface StockResponse { today: string; rows: StockRow[]; suppliers: Supplier[]; deliveries: Delivery[]; supplier_items: SupplierItem[]; movements: LedgerRow[] }

interface LineForm { ingredient_id: string; item_text: string; qty: string; pack_amount: string; price: string; bbf: string }
interface DeliveryForm { id?: string; supplier_id: string; date: string; invoice_no: string; fee: string; notes: string; lines: LineForm[] }

const eur = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const de = (ymd: string) => ymd.split('-').reverse().join('.');
/** cents per g → € per kg; cents per pc → € per pc */
const perKg = (centsPerUnit: number, unit: Ingredient['unit']) => eur(unit === 'g' ? centsPerUnit * 1000 : centsPerUnit);
const emptyLine = (): LineForm => ({ ingredient_id: '', item_text: '', qty: '1', pack_amount: '', price: '', bbf: '' });

export default function StockPage() {
  const [res, setRes] = useState<StockResponse | null>(null);
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<DeliveryForm | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [showMoves, setShowMoves] = useState(false);

  const load = async () => {
    try {
      const [r, d] = await Promise.all([adminFetch<StockResponse>('/api/admin/production/stock'), loadData()]);
      setRes(r); setData(d);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  async function act(body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusy(true);
    try { await adminFetch('/api/admin/production/stock', { body }); showToast(okText, 'success'); await load(); return true; }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!res || !data) return <AdminLoading what="stock" />;

  const ingById = new Map(data.ingredients.map((i) => [i.id, i]));
  const supplierName = new Map(res.suppliers.map((s) => [s.id, s.name]));
  const drafts = res.deliveries.filter((d) => d.status === 'draft');
  const confirmed = res.deliveries.filter((d) => d.status === 'confirmed');
  const openForm = (d?: Delivery) => setForm(d
    ? { id: d.id, supplier_id: d.supplier_id ?? '', date: d.date, invoice_no: d.invoice_no ?? '', fee: d.delivery_fee_cents ? (d.delivery_fee_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '', notes: d.notes ?? '',
        lines: d.lines.map((l) => ({ ingredient_id: l.ingredient_id ?? '', item_text: l.item_text ?? '', qty: String(l.qty), pack_amount: String(l.pack_amount), price: (l.price_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }), bbf: l.bbf ?? '' })) }
    : { supplier_id: res.suppliers[0]?.id ?? '', date: res.today, invoice_no: '', fee: '', notes: '', lines: [emptyLine()] });

  /** Validate + convert the form; returns the API payload or a message. */
  const payload = (f: DeliveryForm) => {
    const fee = parseEuro(f.fee) ?? 0;
    if (Number.isNaN(fee)) return 'Delivery fee is not a number.';
    const lines = f.lines.filter((l) => l.ingredient_id || l.pack_amount || l.price);
    if (lines.length === 0) return 'Add at least one line.';
    const out = [];
    for (const l of lines) {
      const price = parseEuro(l.price) ?? 0;
      if (Number.isNaN(price)) return 'A line price is not a number.';
      if (!(Number(l.qty) > 0) || !(Number(l.pack_amount) > 0)) return 'Every line needs packs and a pack size.';
      out.push({ ingredient_id: l.ingredient_id || null, item_text: l.item_text, qty: Number(l.qty), pack_amount: Number(l.pack_amount), price_cents: price, bbf: l.bbf || null });
    }
    return { id: f.id, supplier_id: f.supplier_id || null, date: f.date, invoice_no: f.invoice_no, delivery_fee_cents: fee, notes: f.notes, lines: out };
  };

  async function saveForm(confirm: boolean) {
    if (!form) return;
    const p = payload(form);
    if (typeof p === 'string') { showToast(p); return; }
    if (confirm && p.lines.some((l) => !l.ingredient_id)) { showToast('Every line needs an ingredient before confirming.'); return; }
    setBusy(true);
    try {
      const { id } = await adminFetch<{ id: string }>('/api/admin/production/stock', { body: { action: 'save_delivery', delivery: p } });
      if (confirm) await adminFetch('/api/admin/production/stock', { body: { action: 'confirm', id } });
      showToast(confirm ? 'Delivery booked.' : 'Draft saved.', 'success');
      setForm(null); await load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function newSupplier() {
    const name = prompt('Supplier name');
    if (!name?.trim()) return;
    try {
      const { id } = await adminFetch<{ id: string }>('/api/admin/production/stock', { body: { action: 'save_supplier', name } });
      await load(); if (form) setForm({ ...form, supplier_id: id });
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  const setLine = (i: number, patch: Partial<LineForm>) => {
    if (!form) return;
    const lines = form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    // pack size and wording remembered per supplier + ingredient
    if (patch.ingredient_id) {
      const known = res.supplier_items.find((x) => x.supplier_id === form.supplier_id && x.ingredient_id === patch.ingredient_id);
      if (known) { lines[i].pack_amount = lines[i].pack_amount || String(known.pack_amount); lines[i].item_text = lines[i].item_text || (known.item_text ?? ''); }
    }
    setForm({ ...form, lines });
  };

  const low = res.rows.filter((r) => r.low).length;
  const expiring = res.rows.filter((r) => r.bbf_days !== null && r.bbf_days <= 30).length;

  return (
    <div>
      <PageHeader title="Stock" subtitle="Levels from booked deliveries, booked bake days and counts. Prices come from the latest delivery."
        actions={!form ? <button className={btnPrimary} onClick={() => openForm()}>New delivery</button> : undefined} />
      <SubNav current="/admin/production/stock" />

      {form && (
        <Card title={form.id ? 'Delivery' : 'New delivery'} className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <L label="Supplier"><div className="flex gap-1">
              <select className={`${smallInputCls} w-full`} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">—</option>{res.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className={btnSecondary} onClick={newSupplier} title="New supplier">+</button>
            </div></L>
            <L label="Date"><input className={`${smallInputCls} w-full`} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></L>
            <L label="Invoice no."><input className={`${smallInputCls} w-full`} value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></L>
            <L label="Delivery fee € (net)"><input className={`${smallInputCls} w-full`} value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="0,00" /></L>
            <L label="Note"><input className={`${smallInputCls} w-full`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></L>
          </div>
          <table className="w-full">
            <thead><tr><th className={th}>Ingredient</th><th className={th}>Wording on the invoice</th><th className={`${th} text-right`}>Packs</th><th className={`${th} text-right`}>Pack size</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Price € (net)</th><th className={th}>Best-before</th><th className={th}></th></tr></thead>
            <tbody>
              {form.lines.map((l, i) => {
                const ing = ingById.get(l.ingredient_id);
                const amount = Number(l.qty) * Number(l.pack_amount);
                return (
                  <tr key={i} className="border-t border-smitten-cream">
                    <td className={td}><select className={`${smallInputCls} w-44`} value={l.ingredient_id} onChange={(e) => setLine(i, { ingredient_id: e.target.value })}>
                      <option value="">—</option>{data.ingredients.filter((x) => !x.derived_from).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select></td>
                    <td className={td}><input className={`${smallInputCls} w-full`} value={l.item_text} onChange={(e) => setLine(i, { item_text: e.target.value })} /></td>
                    <td className={tdNum}><input className={`${smallInputCls} w-16 text-right`} type="number" step="any" min="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                    <td className={tdNum}><input className={`${smallInputCls} w-24 text-right`} type="number" step="any" min="0" value={l.pack_amount} onChange={(e) => setLine(i, { pack_amount: e.target.value })} /> <span className="text-xs text-smitten-text/50">{ing?.unit ?? 'g'}</span></td>
                    <td className={tdNum}>{amount > 0 ? `${fmtG(amount)} ${ing?.unit ?? 'g'}` : ''}</td>
                    <td className={tdNum}><input className={`${smallInputCls} w-24 text-right`} value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} placeholder="0,00" /></td>
                    <td className={td}>{ing?.track_bbf && <input className={smallInputCls} type="date" value={l.bbf} onChange={(e) => setLine(i, { bbf: e.target.value })} />}</td>
                    <td className={`${td} text-right`}><button className="text-xs text-red-700 dark:text-red-400" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btnSecondary} onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}>+ line</button>
            <span className="flex-1" />
            <button className={btnSecondary} onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className={btnSecondary} onClick={() => saveForm(false)} disabled={busy}>Save draft</button>
            <button className={btnPrimary} onClick={() => saveForm(true)} disabled={busy}>Book delivery</button>
          </div>
        </Card>
      )}

      {drafts.length > 0 && !form && (
        <Card title="Open drafts" className="mb-6">
          <table className="w-full"><tbody>
            {drafts.map((d) => (
              <tr key={d.id} className="border-t border-smitten-cream first:border-t-0">
                <td className={td}>{de(d.date)}</td>
                <td className={td}>{d.supplier_id ? supplierName.get(d.supplier_id) : '—'}{d.invoice_no ? ` · ${d.invoice_no}` : ''}</td>
                <td className={`${td} text-smitten-text/60`}>{d.lines.map((l) => (l.ingredient_id ? ingById.get(l.ingredient_id)?.name : l.item_text || '?')).join(', ')}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <button className="text-xs underline mr-3" onClick={() => openForm(d)}>edit</button>
                  <button className="text-xs underline mr-3" disabled={busy} onClick={() => act({ action: 'confirm', id: d.id }, 'Delivery booked.')}>book</button>
                  <button className={btnDanger} disabled={busy} onClick={() => { if (confirm('Delete this draft?')) act({ action: 'delete_delivery', id: d.id }, 'Draft deleted.'); }}>delete</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}

      <Card title={<span>Levels {low > 0 && <span className="ml-2 text-xs font-normal text-red-700 dark:text-red-400">{low} below reorder level</span>}{expiring > 0 && <span className="ml-2 text-xs font-normal text-red-700 dark:text-red-400">{expiring} expiring within 30 days</span>}</span>} className="mb-6">
        <table className="w-full">
          <thead><tr><th className={th}>Ingredient</th><th className={`${th} text-right`}>In stock</th><th className={`${th} text-right`}>Reorder</th><th className={th}>Best-before</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Count</th></tr></thead>
          <tbody>
            {res.rows.map((r) => {
              const unitLabel = r.unit === 'g' ? 'kg' : 'pc';
              const red = 'text-red-700 dark:text-red-400 font-medium';
              return (
                <tr key={r.ingredient_id} className="border-t border-smitten-cream">
                  <td className={`${td} font-medium`}>{r.name}</td>
                  <td className={`${tdNum} ${r.low ? red : ''}`}>{fmtG(r.level)} {r.unit}</td>
                  <td className={`${tdNum} text-smitten-text/60`}>{r.reorder_level !== null ? `${fmtG(r.reorder_level)} ${r.unit}` : ''}</td>
                  <td className={`${td} ${r.bbf_days !== null && r.bbf_days <= 30 ? red : ''}`}>{r.bbf ? de(r.bbf) : ''}</td>
                  <td className={tdNum}>{r.price ? <>{perKg(r.price.unit_price, r.unit)}<span className="text-xs text-smitten-text/50">/{unitLabel}{r.price.delivery_share > 0 ? ` + ${perKg(r.price.delivery_share, r.unit)} delivery` : ''}</span></> : <span className="text-xs text-smitten-text/40">no price</span>}</td>
                  <td className={`${tdNum} whitespace-nowrap`}>
                    <input className={`${smallInputCls} w-24 text-right`} type="number" step="any" min="0" placeholder={r.unit} value={counts[r.ingredient_id] ?? ''} onChange={(e) => setCounts({ ...counts, [r.ingredient_id]: e.target.value })} />
                    <button className="ml-2 text-xs underline" disabled={busy || !counts[r.ingredient_id]} onClick={async () => { if (await act({ action: 'set_count', ingredient_id: r.ingredient_id, counted: Number(counts[r.ingredient_id]) }, 'Count booked.')) setCounts({ ...counts, [r.ingredient_id]: '' }); }}>set</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {res.movements.length > 0 && (
          <div className="mt-3 text-xs">
            <button className="underline text-smitten-text/60" onClick={() => setShowMoves(!showMoves)}>{showMoves ? 'hide counts' : `counts and corrections (${res.movements.length})`}</button>
            {showMoves && <ul className="mt-2 space-y-0.5">{res.movements.map((m) => <li key={m.id} className="flex gap-3"><span className="text-smitten-text/50 w-20">{de(m.date)}</span><span className="w-44">{ingById.get(m.ingredient_id)?.name}</span><span className="tabular-nums w-20 text-right">{m.amount > 0 ? '+' : ''}{fmtG(m.amount)}</span><span className="text-smitten-text/50 flex-1">{m.note}</span><button className="text-red-700 dark:text-red-400" disabled={busy} onClick={() => act({ action: 'delete_movement', id: m.id }, 'Removed.')}>✕</button></li>)}</ul>}
          </div>
        )}
      </Card>

      <Card title="Deliveries">
        {confirmed.length === 0 ? <p className="text-sm text-smitten-text/50">None booked yet.</p> : (
          <table className="w-full">
            <thead><tr><th className={th}>Date</th><th className={th}>Supplier</th><th className={th}>Invoice</th><th className={th}>Lines</th><th className={`${th} text-right`}>Goods</th><th className={`${th} text-right`}>Delivery</th><th className={th}></th></tr></thead>
            <tbody>
              {confirmed.map((d) => (
                <tr key={d.id} className="border-t border-smitten-cream">
                  <td className={td}>{de(d.date)}</td>
                  <td className={td}>{d.supplier_id ? supplierName.get(d.supplier_id) : '—'}</td>
                  <td className={`${td} text-smitten-text/60`}>{d.invoice_no ?? ''}</td>
                  <td className={`${td} text-xs text-smitten-text/70`}>{d.lines.map((l) => `${ingById.get(l.ingredient_id ?? '')?.name ?? '?'} ${fmtG(l.amount)} ${ingById.get(l.ingredient_id ?? '')?.unit ?? ''}`).join(', ')}</td>
                  <td className={tdNum}>{eur(d.lines.reduce((s, l) => s + l.price_cents, 0))}</td>
                  <td className={tdNum}>{d.delivery_fee_cents ? eur(d.delivery_fee_cents) : ''}</td>
                  <td className={`${td} text-right`}><button className="text-xs underline text-smitten-text/60" disabled={busy} onClick={() => { if (confirm('Undo this booking? The stock and the prices go back to before.')) act({ action: 'unconfirm', id: d.id }, 'Booking undone.'); }}>undo</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] text-smitten-text/60 mb-1">{label}</span>{children}</label>;
}
