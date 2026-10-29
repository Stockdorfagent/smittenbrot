'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill, type PillTone } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Bold, Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary } from '@/components/admin/production/ui';
import { adminFetch, fmtG } from '@/lib/production/client';
import { TRACE_NOTICE } from '@/lib/productInfo';
import { buildIngredientLabelPdf, type LabelProduct } from '@/lib/production/ingredientLabelPdf';
import type { ProductListRow, ListStatus } from '@/lib/production/listStatus';

const STATUS: Record<ListStatus, { label: string; tone: PillTone }> = {
  ok: { label: 'approved · up to date', tone: 'green' },
  outdated: { label: 'outdated – approve again', tone: 'amber' },
  new: { label: 'not yet approved', tone: 'amber' },
  blocked: { label: 'blocked', tone: 'red' },
  manual: { label: 'manual – not generated', tone: 'purple' },
  no_recipe: { label: 'no recipe', tone: 'gray' },
};

export default function IngredientListsPage() {
  const [rows, setRows] = useState<ProductListRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => adminFetch<{ rows: ProductListRow[] }>('/api/admin/production/ingredient-lists').then((r) => setRows(r.rows)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try { const r = await adminFetch<{ approved?: string[] }>('/api/admin/production/ingredient-lists', { body }); showToast(r.approved ? `${okText} (${r.approved.length})` : okText, 'success'); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  /** Label PDF (logo, name, approved list with allergens in bold, notice; no weight) — built in the browser. */
  async function labelPdf(items: ProductListRow[], filename: string) {
    const products: LabelProduct[] = items.filter((r) => r.approved_text).map((r) => ({ name: r.name, ingredients: r.approved_text!, allergens: r.current_allergens }));
    if (products.length === 0) { showToast('No approved list to print.'); return; }
    setBusy(true);
    try {
      const logo = await fetch('/logo-with-www.png').then((x) => x.arrayBuffer()).catch(() => null);
      const bytes = await buildIngredientLabelPdf(products, logo);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const slug = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!rows) return <AdminLoading what="ingredient lists" />;

  const pending = rows.filter((r) => r.status === 'new' || r.status === 'outdated');
  const blocked = rows.filter((r) => r.status === 'blocked');

  return (
    <div>
      <PageHeader
        title="Ingredient lists"
        subtitle="Generated from the recipes: one piece expanded, grouped by German name, sorted by weight at the time of use, allergens emphasised. Nothing reaches the shop until you approve it."
        actions={<div className="flex gap-2">
          {pending.length > 0 && <button className={btnPrimary} disabled={busy} onClick={() => { if (confirm(`Approve ${pending.length} list(s) and publish them to the shop?`)) act({ action: 'approve_all' }, 'Approved'); }}>Approve all pending ({pending.length})</button>}
          <button className={btnSecondary} disabled={busy} onClick={() => labelPdf(rows.filter((r) => r.active && r.approved_text), 'Zutaten_alle.pdf')} title="One page per product: logo, name, ingredients, allergens, notice">All lists as PDF</button>
        </div>}
      />
      <SubNav current="/admin/production/ingredient-lists" />

      {blocked.length > 0 && <div className="mb-4"><Notice tone="error">Blocked: {blocked.map((b) => `${b.name} (${b.generated?.blocked.join(' ')})`).join(' · ')} — fix on the <Link href="/admin/production/ingredients" className="underline">Ingredients</Link> page.</Notice></div>}
      <div className="mb-4"><Notice tone="info">The cross-contact notice stays a fixed text under every list: “{TRACE_NOTICE}”</Notice></div>

      {rows.map((r) => {
        const st = STATUS[r.status];
        const isOpen = open === r.product_id;
        return (
          <Card key={r.product_id} className="mb-3"
            title={<button className="text-left" onClick={() => setOpen(isOpen ? null : r.product_id)}>{r.name} {!r.active && <span className="text-xs font-normal text-smitten-text/40">(inactive)</span>}</button>}
            right={<div className="flex items-center gap-2">
              <StatusPill tone={st.tone}>{st.label}</StatusPill>
              {(r.status === 'new' || r.status === 'outdated') && <button className={btnPrimary} disabled={busy} onClick={() => act({ action: 'approve', product_id: r.product_id }, `${r.name} approved.`)}>Approve</button>}
              {r.approved_text && <button className={btnSecondary} disabled={busy} onClick={() => labelPdf([r], `Zutaten_${slug(r.name)}.pdf`)} title="Label PDF: logo, name, ingredients, allergens, notice — no weight">PDF</button>}
              <button className="text-xs underline text-smitten-text/60" onClick={() => setOpen(isOpen ? null : r.product_id)}>{isOpen ? 'hide' : 'show'}</button>
            </div>}>
            {isOpen && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">In the shop now</p>
                  <p>{r.approved_text ? <Bold text={r.approved_text} /> : (r.current_ingredients || <span className="text-smitten-text/40">nothing</span>)}</p>
                  <p className="mt-1 text-xs text-smitten-text/60">Allergene: {r.current_allergens || '–'}</p>
                  {r.approved_at && <p className="text-[11px] text-smitten-text/40 mt-1">approved {new Date(r.approved_at).toLocaleString('en-GB')}</p>}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-smitten-text/50 mb-1">Generated from the recipes</p>
                  {r.generated ? (
                    <>
                      <p><Bold text={r.generated.text} /></p>
                      <p className="mt-1 text-xs text-smitten-text/60">Allergene: {r.generated.allergens_text || '–'}{r.allergens_changed && <span className="text-amber-700 dark:text-amber-300"> (changed)</span>}</p>
                      <p className="mt-1 text-[11px] text-smitten-text/40">App (legacy column): {r.generated.legacy}</p>
                      {r.generated.blocked.length > 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{r.generated.blocked.join(' ')}</p>}
                      {r.diff && !r.diff.same && (
                        <div className="mt-2 text-xs">
                          {r.diff.removed.length > 0 && <p className="text-red-700 dark:text-red-400">− {r.diff.removed.join(', ')}</p>}
                          {r.diff.added.length > 0 && <p className="text-green-700 dark:text-green-400">+ {r.diff.added.join(', ')}</p>}
                        </div>
                      )}
                      <details className="mt-2 text-xs text-smitten-text/60">
                        <summary className="cursor-pointer">weights per piece</summary>
                        <ul>{r.generated.entries.map((e) => <li key={e.name_de}><Bold text={e.name_de} />: {fmtG(e.grams)} g{e.allergens.length ? ` · ${e.allergens.join(', ')}` : ''}</li>)}</ul>
                      </details>
                    </>
                  ) : <p className="text-smitten-text/40">No production product linked — link it on the <Link href="/admin/production/products" className="underline">Products</Link> page.</p>}
                </div>
                {r.status !== 'no_recipe' && (
                  <div className="lg:col-span-2 flex gap-2">
                    {r.status === 'manual'
                      ? <button className={btnSecondary} disabled={busy} onClick={() => act({ action: 'set_manual', product_id: r.product_id, manual: false }, 'Back to generated lists.')}>Use the generated list again</button>
                      : <button className="text-xs underline text-smitten-text/60" disabled={busy} onClick={() => { if (confirm('Switch this product to a manual ingredient list? The generated list is then ignored and the fields on the product page become editable again.')) act({ action: 'set_manual', product_id: r.product_id, manual: true }, 'Set to manual.'); }}>switch to manual</button>}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
