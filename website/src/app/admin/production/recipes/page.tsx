'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, btnPrimary, btnDanger, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, fmtPct, loadData } from '@/lib/production/client';
import { recipeBuildMargin, recipeMarginFactor, sumPct } from '@/lib/production/engine';
import type { ProductionData } from '@/lib/production/types';

export default function RecipesPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState('');

  const load = () => loadData().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function remove(id: string, name: string) {
    if (!confirm(`Delete recipe "${name}" and all its versions?`)) return;
    try {
      await adminFetch('/api/admin/production/recipes', { method: 'DELETE', body: { id } });
      showToast('Recipe deleted.', 'success');
      load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <AdminLoading what="recipes" />;

  const usedBy = (recipeId: string) => data.products.filter((p) => p.recipe_id === recipeId).map((p) => p.name);
  const usedAsSub = (recipeId: string) => data.recipes.filter((r) => r.items.some((it) => it.sub_recipe_id === recipeId)).map((r) => r.name);

  return (
    <div>
      <PageHeader
        title="Recipes"
        subtitle="Pure baker's percentages, no margins. Every save creates a new version."
        actions={<Link href="/admin/production/recipes/new" className={btnPrimary}>New recipe</Link>}
      />
      <SubNav current="/admin/production/recipes" />

      {(['dough', 'sub'] as const).map((kind) => (
        <Card key={kind} title={kind === 'dough' ? 'Doughs' : 'Sub-recipes (pre-doughs, poolish, soakers)'} className="mb-6">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={`${th} text-right`}>Σ %</th>
                <th className={`${th} text-right`}>{kind === 'dough' ? 'Dough margin' : 'Build margin %'}</th>
                <th className={`${th} text-right`}>Max batch g</th>
                <th className={th}>{kind === 'dough' ? 'Products' : 'Used by'}</th>
                <th className={`${th} text-right`}>Version</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {data.recipes.filter((r) => r.kind === kind).map((r) => {
                const users = kind === 'dough' ? usedBy(r.id) : usedAsSub(r.id);
                const margin = kind === 'dough' ? recipeMarginFactor(r, data.settings) : recipeBuildMargin(r, data.settings);
                const isDefault = kind === 'dough' ? r.dough_margin_factor === null : r.build_margin_pct === null;
                return (
                  <tr key={r.id} className="border-t border-smitten-cream">
                    <td className={td}><Link href={`/admin/production/recipes/${r.id}`} className="font-medium hover:text-smitten-primary">{r.name}</Link></td>
                    <td className={tdNum}>{fmtPct(sumPct(r))}</td>
                    <td className={tdNum}>{margin}{isDefault && <span className="text-xs text-smitten-text/40"> (default)</span>}</td>
                    <td className={tdNum}>{r.max_batch_g ?? ''}</td>
                    <td className={td}>{users.length ? users.join(', ') : <StatusPill tone="gray">unused</StatusPill>}</td>
                    <td className={tdNum}>v{r.current_version}</td>
                    <td className={`${td} text-right`}><button className={btnDanger} onClick={() => remove(r.id, r.name)}>delete</button></td>
                  </tr>
                );
              })}
              {data.recipes.filter((r) => r.kind === kind).length === 0 && <tr><td className={td} colSpan={7}><span className="text-smitten-text/50">None yet.</span></td></tr>}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
