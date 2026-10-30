'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnDanger, btnPrimary, btnSecondary, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, fmtG, loadData } from '@/lib/production/client';
import { parseEuro, type BatchPlan, type StockRow } from '@/lib/production/stock';
import type { MatchedInvoice } from '@/lib/production/invoiceMatch';
import { supabase } from '@/lib/supabase';
import type { Batch, Delivery, Ingredient, LedgerRow, ProductionData, Supplier, SupplierItem } from '@/lib/production/types';

interface StockResponse { today: string; rows: StockRow[]; suppliers: Supplier[]; deliveries: Delivery[]; supplier_items: SupplierItem[]; movements: LedgerRow[]; batches: Batch[] }
interface BatchForm { ingredient_id: string; amount: string; date: string; note: string }

interface LineForm { ingredient_id: string; item_text: string; qty: string; pack_amount: string; price: string; bbf: string }
interface DeliveryForm { id?: string; supplier_id: string; date: string; invoice_no: string; fee: string; notes: string; lines: LineForm[]; file_path?: string | null; hints?: string[] }

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
  const [reading, setReading] = useState(false);
  const [batch, setBatch] = useState<BatchForm | null>(null);
  const [plan, setPlan] = useState<BatchPlan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const [r, d] = await Promise.all([adminFetch<StockResponse>('/api/admin/production/stock'), loadData()]);
      setRes(r); setData(d);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []);

  // batch preview: the recipe expanded for the typed amount, priced on the server (nothing saved)
  const planKey = batch ? `${batch.ingredient_id}|${batch.amount}` : '';
  useEffect(() => {
    if (!batch?.ingredient_id || !(Number(batch.amount) > 0)) { setPlan(null); return; }
    let live = true;
    const t = setTimeout(() => {
      adminFetch<BatchPlan>('/api/admin/production/stock', { body: { action: 'plan_batch', ingredient_id: batch.ingredient_id, amount: Number(batch.amount) } })
        .then((p) => { if (live) setPlan(p); }).catch(() => { if (live) setPlan(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

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
    ? { id: d.id, supplier_id: d.supplier_id ?? '', date: d.date, invoice_no: d.invoice_no ?? '', fee: d.delivery_fee_cents ? (d.delivery_fee_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '', notes: d.notes ?? '', file_path: d.file_path,
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
    return { id: f.id, supplier_id: f.supplier_id || null, date: f.date, invoice_no: f.invoice_no, delivery_fee_cents: fee, notes: f.notes, lines: out, file_path: f.file_path ?? null };
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

  /** Phase 2: the invoice is read on the server and comes back as a prefilled form; nothing is saved until the owner does. */
  async function uploadInvoice(file: File) {
    setReading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/admin/production/stock/read-invoice', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      const d = j.draft as MatchedInvoice;
      let supplierId = d.supplier_id ?? '';
      if (!supplierId && d.supplier_name) {
        const { id } = await adminFetch<{ id: string }>('/api/admin/production/stock', { body: { action: 'save_supplier', name: d.supplier_name } });
        supplierId = id; await load();
      }
      setForm({
        supplier_id: supplierId, date: d.date, invoice_no: d.invoice_no ?? '', fee: d.delivery_fee_cents ? (d.delivery_fee_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '', notes: '',
        file_path: j.file_path, hints: d.notes.filter((n) => !n.includes('is new')),
        lines: d.lines.length ? d.lines.map((l) => ({ ingredient_id: l.ingredient_id ?? '', item_text: l.item_text, qty: String(l.qty), pack_amount: l.pack_amount !== null ? String(l.pack_amount) : '', price: (l.price_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }), bbf: l.bbf ?? '' })) : [emptyLine()],
      });
      window.scrollTo({ top: 0 });
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function openFile(path: string) {
    try { const { url } = await adminFetch<{ url: string }>(`/api/admin/production/stock/file?path=${encodeURIComponent(path)}`); window.open(url, '_blank'); }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
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

  const homemade = data.ingredients.filter((i) => i.made_from_recipe_id);
  const openBatch = () => { setForm(null); setBatch({ ingredient_id: homemade[0]?.id ?? '', amount: '', date: res.today, note: '' }); };
  async function bookBatch() {
    if (!batch || !plan || plan.error || plan.missing.length) return;
    if (await act({ action: 'book_batch', ingredient_id: batch.ingredient_id, amount: Number(batch.amount), date: batch.date, note: batch.note }, 'Batch booked.')) { setBatch(null); setPlan(null); }
  }
  const low = res.rows.filter((r) => r.low).length;
  const expiring = res.rows.filter((r) => r.bbf_days !== null && r.bbf_days <= 30).length;

  return (
    <div>
      <PageHeader title="Stock" subtitle="Levels from booked deliveries, batches, booked bake days and counts. Prices come from the latest delivery or batch."
        actions={!form && !batch ? <>
          <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadInvoice(f); }} />
          {homemade.length > 0 && <button className={btnSecondary} onClick={openBatch}>Make batch</button>}
          <button className={btnSecondary} disabled={reading} onClick={() => fileInput.current?.click()}>{reading ? 'Reading…' : 'Upload invoice'}</button>
          <button className={btnPrimary} onClick={() => openForm()}>New delivery</button>
        </> : undefined} />
      <SubNav current="/admin/production/stock" />

      {form && (
        <Card title={form.id ? 'Delivery' : 'New delivery'} className="mb-6" right={form.file_path ? <button className="text-xs underline text-smitten-text/60" onClick={() => openFile(form.file_path!)}>open invoice</button> : undefined}>
          {form.hints && form.hints.length > 0 && <div className="mb-3"><Notice tone="warning">Read from the invoice — check: {form.hints.join(' ')}</Notice></div>}
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

      {batch && (
        <Card title="Make batch" className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <L label="Ingredient"><select className={`${smallInputCls} w-full`} value={batch.ingredient_id} onChange={(e) => setBatch({ ...batch, ingredient_id: e.target.value })}>
              {homemade.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></L>
            <L label={`Amount made (${ingById.get(batch.ingredient_id)?.unit ?? 'g'})`}><input className={`${smallInputCls} w-full`} type="number" step="any" min="0" value={batch.amount} onChange={(e) => setBatch({ ...batch, amount: e.target.value })} autoFocus /></L>
            <L label="Date"><input className={`${smallInputCls} w-full`} type="date" value={batch.date} onChange={(e) => setBatch({ ...batch, date: e.target.value })} /></L>
            <L label="Note" className="md:col-span-2"><input className={`${smallInputCls} w-full`} value={batch.note} onChange={(e) => setBatch({ ...batch, note: e.target.value })} /></L>
          </div>
          {plan && plan.error && <Notice tone="error">{plan.error}</Notice>}
          {plan && !plan.error && (
            <>
              <table className="w-full">
                <thead><tr><th className={th}>Component</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Goods</th><th className={`${th} text-right`}>Delivery</th></tr></thead>
                <tbody>
                  {plan.lines.map((l) => (
                    <tr key={l.ingredient_id} className="border-t border-smitten-cream">
                      <td className={td}>{l.name}</td>
                      <td className={tdNum}>{fmtG(l.amount)} {l.unit}</td>
                      <td className={`${tdNum} ${plan.missing.includes(l.name) ? 'text-red-700 dark:text-red-400' : ''}`}>{plan.missing.includes(l.name) ? 'no price' : eur(l.goods_cents)}</td>
                      <td className={`${tdNum} text-smitten-text/60`}>{l.delivery_cents > 0 ? eur(l.delivery_cents) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-smitten-cream font-medium">
                    <td className={td}>{ingById.get(batch.ingredient_id)?.name} · {fmtG(plan.amount)} {ingById.get(batch.ingredient_id)?.unit}</td>
                    <td className={tdNum}>{perKg(plan.goods_cents / plan.amount, ingById.get(batch.ingredient_id)?.unit ?? 'g')}<span className="text-xs text-smitten-text/50 font-normal">/{(ingById.get(batch.ingredient_id)?.unit ?? 'g') === 'g' ? 'kg' : 'pc'}</span></td>
                    <td className={tdNum}>{eur(plan.goods_cents)}</td>
                    <td className={`${tdNum} text-smitten-text/60`}>{plan.delivery_cents > 0 ? eur(plan.delivery_cents) : ''}</td>
                  </tr>
                </tbody>
              </table>
              {plan.missing.length > 0 && <div className="mt-2"><Notice tone="warning">No price yet for {plan.missing.join(', ')}. Book the purchase first.</Notice></div>}
            </>
          )}
          <div className="mt-3 flex gap-2">
            <span className="flex-1" />
            <button className={btnSecondary} onClick={() => { setBatch(null); setPlan(null); }} disabled={busy}>Cancel</button>
            <button className={btnPrimary} onClick={bookBatch} disabled={busy || !plan || !!plan.error || plan.missing.length > 0}>Book batch</button>
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
                  <td className={`${td} text-smitten-text/60`}>{d.invoice_no ?? ''}{d.file_path && <button className="ml-2 text-xs underline" onClick={() => openFile(d.file_path!)}>pdf</button>}</td>
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

      {res.batches.length > 0 && (
        <Card title="Batches" className="mt-6">
          <table className="w-full">
            <thead><tr><th className={th}>Date</th><th className={th}>Made</th><th className={th}>From</th><th className={`${th} text-right`}>Goods</th><th className={`${th} text-right`}>Delivery</th><th className={th}></th></tr></thead>
            <tbody>
              {res.batches.map((b) => {
                const made = ingById.get(b.ingredient_id);
                return (
                  <tr key={b.id} className="border-t border-smitten-cream">
                    <td className={td}>{de(b.date)}</td>
                    <td className={`${td} font-medium`}>{made?.name ?? '?'} {fmtG(b.amount)} {made?.unit ?? ''}{b.note ? <span className="font-normal text-smitten-text/60"> · {b.note}</span> : null}</td>
                    <td className={`${td} text-xs text-smitten-text/70`}>{b.lines.map((l) => `${ingById.get(l.ingredient_id)?.name ?? '?'} ${fmtG(l.amount)} ${ingById.get(l.ingredient_id)?.unit ?? ''}`).join(', ')}</td>
                    <td className={tdNum}>{eur(b.goods_cents)}<span className="text-xs text-smitten-text/50"> · {perKg(b.goods_cents / b.amount, made?.unit ?? 'g')}/{(made?.unit ?? 'g') === 'g' ? 'kg' : 'pc'}</span></td>
                    <td className={`${tdNum} text-smitten-text/60`}>{b.delivery_cents ? eur(b.delivery_cents) : ''}</td>
                    <td className={`${td} text-right`}><button className="text-xs underline text-smitten-text/60" disabled={busy} onClick={() => { if (confirm('Undo this batch? The stock and the price go back to before.')) act({ action: 'delete_batch', id: b.id }, 'Batch undone.'); }}>undo</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function L({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className ?? ''}`}><span className="block text-[11px] text-smitten-text/60 mb-1">{label}</span>{children}</label>;
}
