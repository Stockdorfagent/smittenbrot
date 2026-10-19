'use client';

import { useState } from 'react';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnSecondary } from '@/components/admin/production/ui';
import { adminDownload, adminFetch } from '@/lib/production/client';
import type { ImportPlan } from '@/lib/production/csvImport';

const FILES = ['ingredients', 'recipes', 'products', 'recipe_lines'] as const;
type FileKey = typeof FILES[number];

export default function ImportPage() {
  const [texts, setTexts] = useState<Partial<Record<FileKey, string>>>({});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function onFile(key: FileKey, file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setTexts((t) => ({ ...t, [key]: text }));
    setPlan(null);
  }

  const ready = FILES.every((k) => (texts[k] ?? '').trim().length > 0);

  async function preview() {
    setBusy(true); setDone(null);
    try {
      const r = await adminFetch<{ plan: ImportPlan }>('/api/admin/production/import', { body: { files: texts } });
      setPlan(r.plan);
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function commit() {
    if (!plan || plan.errors.length) return;
    if (replace && confirmText !== 'REPLACE') { showToast('Type REPLACE to confirm wiping the existing recipes.'); return; }
    setBusy(true);
    try {
      const r = await adminFetch<{ committed: { ingredients: number; starters: number; recipes: number; products: number } }>('/api/admin/production/import', { body: { files: texts, commit: true, replace } });
      setDone(`Imported ${r.committed.ingredients} ingredients, ${r.committed.starters} starters, ${r.committed.recipes} recipes, ${r.committed.products} products.`);
      setPlan(null); setTexts({}); setReplace(false); setConfirmText('');
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Import / backup"
        subtitle="One-time import from the four CSV files (ingredients, recipes, products, recipe_lines). Afterwards everything is maintained in the interface; the backup exports the same four files."
        actions={<button className={btnSecondary} onClick={() => adminDownload('/api/admin/production/export', 'recipes-backup.zip').then((n) => showToast(`${n} downloaded.`, 'success')).catch((e) => showToast(e.message))}>Download backup (zip)</button>}
      />
      <SubNav current="/admin/production/import" />

      {done && <div className="mb-6"><Notice tone="success">{done}</Notice></div>}

      <Card title="1. Choose the four files">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FILES.map((k) => (
            <label key={k} className="block">
              <span className="block text-xs text-smitten-text/60 mb-1">{k}.csv {texts[k] ? <span className="text-green-700 dark:text-green-400">✓ loaded</span> : ''}</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(k, e.target.files?.[0])} className="text-sm" />
            </label>
          ))}
        </div>
        <p className="text-xs text-smitten-text/50 mt-3">Separator , or ; is detected automatically; UTF-8; decimal comma is accepted inside quoted fields. Unknown ingredient names are reported, never guessed.</p>
        <div className="mt-3"><button className={btnPrimary} onClick={preview} disabled={!ready || busy}>Preview</button></div>
      </Card>

      {plan && (
        <Card title="2. Preview" className="mt-6">
          <p className="text-sm mb-2">{plan.ingredients.length} ingredients · {plan.starters.length} starters · {plan.recipes.length} recipes ({plan.recipes.filter((r) => r.kind === 'dough').length} doughs, {plan.recipes.filter((r) => r.kind === 'sub').length} subs) · {plan.products.length} products ({plan.products.filter((p) => p.link_status === 'linked').length} linked to the shop, {plan.products.filter((p) => p.link_status === 'pending').length} pending, {plan.products.filter((p) => p.link_status === 'internal').length} internal)</p>
          {plan.errors.length > 0 && <Notice tone="error"><p className="font-medium mb-1">{plan.errors.length} error{plan.errors.length > 1 ? 's' : ''} — nothing will be written:</p><ul className="list-disc pl-4">{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          {plan.warnings.length > 0 && <div className="mt-2"><Notice tone="warning"><ul className="list-disc pl-4">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice></div>}
          <div className="mt-3 text-sm">
            <p className="font-medium mb-1">Recipes</p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {plan.recipes.map((r) => <li key={r.name} className="py-0.5">{r.name} <span className="text-xs text-smitten-text/50">({r.kind}, {r.lines.length} lines, Σ {Math.round(r.sum_pct * 100) / 100} %)</span></li>)}
            </ul>
          </div>
          <div className="mt-4 border-t border-smitten-cream pt-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace everything (wipes all existing ingredients, starters, recipes, versions and product links first)</label>
            {replace && <input className="mt-2 px-3 py-2 rounded-lg border border-red-300 text-sm" placeholder="type REPLACE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}
            <div className="mt-3"><button className={btnPrimary} onClick={commit} disabled={busy || plan.errors.length > 0}>Import</button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
