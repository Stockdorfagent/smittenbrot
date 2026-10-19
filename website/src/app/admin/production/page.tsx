'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { Card, Notice, PageHeader, SubNav, inputCls, btnSecondary } from '@/components/admin/production/ui';
import { adminFetch, loadData } from '@/lib/production/client';
import { addDays, berlinTodayISO, cutoffInfo, formatDateEN, recentBakeDays, upcomingBakeDays, isValidISODate, isBakeDay } from '@/lib/production/bakeDays';
import { b2bDays } from '@/lib/production/b2b';
import type { B2BClient, DayOverride, ManualOrder, ProductionData, StandingOrder } from '@/lib/production/types';

type B2BResponse = { clients: B2BClient[]; standing: StandingOrder[]; upcoming_manual: ManualOrder[]; upcoming_overrides: DayOverride[] };

export default function ProductionOverviewPage() {
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState('');
  const [b2b, setB2B] = useState<B2BResponse | null>(null);

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message));
    adminFetch<B2BResponse>(`/api/admin/production/b2b?since=${addDays(berlinTodayISO(), -14)}`).then(setB2B).catch((e) => setError(e.message));
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <AdminLoading what="production" />;

  const today = berlinTodayISO();
  const shopUpcoming = upcomingBakeDays(4);
  const shopRecent = recentBakeDays(4);
  // B2B deliveries may fall on any weekday: a date with B2B work is a bake day too.
  const extra = b2b ? b2bDays(shopRecent[shopRecent.length - 1] ?? today, shopUpcoming[shopUpcoming.length - 1], b2b.clients, b2b.standing, b2b.upcoming_overrides, b2b.upcoming_manual) : [];
  const upcoming = [...new Set([...shopUpcoming, ...extra.filter((d) => d >= today)])].sort();
  const recent = [...new Set([...shopRecent, ...extra.filter((d) => d < today)])].sort().reverse();
  const pending = data.products.filter((p) => p.link_status === 'pending');
  const unchecked = data.ingredients.filter((i) => i.allergens === null);
  const unlinkedOrders = data.products.filter((p) => p.production === 'orders' && !p.recipe_id);

  return (
    <div>
      <PageHeader title="Production" subtitle="Recipes, bake sheets and starter feeding — calculated from the shop's orders and the B2B orders. Shop days are Wednesday and Saturday; B2B deliveries can fall on any day." />
      <SubNav current="/admin/production" />

      {(pending.length > 0 || unchecked.length > 0 || unlinkedOrders.length > 0 || data.recipes.length === 0) && (
        <div className="space-y-2 mb-6">
          {data.recipes.length === 0 && <Notice tone="warning">No recipes yet. <Link href="/admin/production/import" className="underline">Import the CSV files</Link> or <Link href="/admin/production/recipes/new" className="underline">create a recipe</Link>.</Notice>}
          {unlinkedOrders.length > 0 && <Notice tone="warning">Products without a recipe: {unlinkedOrders.map((p) => p.name).join(', ')} — <Link href="/admin/production/products" className="underline">link them</Link>.</Notice>}
          {pending.length > 0 && <Notice tone="info">Pending links (not in the shop yet, linked automatically once the product exists): {pending.map((p) => p.name).join(', ')}.</Notice>}
          {unchecked.length > 0 && <Notice tone="info">Allergens not yet checked for {unchecked.length} ingredient{unchecked.length > 1 ? 's' : ''} ({unchecked.map((i) => i.name).join(', ')}) — needed before customer ingredient lists can be generated.</Notice>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Upcoming bake days">
          <ul className="divide-y divide-smitten-cream">
            {upcoming.map((d) => {
              const c = cutoffInfo(d);
              return (
                <li key={d} className="py-2.5 flex items-center justify-between gap-3">
                  <Link href={`/admin/production/bake-day/${d}`} className="text-sm font-medium text-smitten-text hover:text-smitten-primary">{formatDateEN(d)}</Link>
                  <span className="flex gap-1">
                    {extra.includes(d) && <StatusPill tone="blue">B2B</StatusPill>}
                    {isBakeDay(d) ? <StatusPill tone={c.passed ? 'green' : 'amber'}>{c.passed ? 'cut-off passed' : `cut-off ${c.label}`}</StatusPill> : <StatusPill tone="gray">no shop orders</StatusPill>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Recent bake days">
          <ul className="divide-y divide-smitten-cream">
            {recent.map((d) => (
              <li key={d} className="py-2.5 flex items-center justify-between gap-3">
                <Link href={`/admin/production/bake-day/${d}`} className="text-sm font-medium text-smitten-text hover:text-smitten-primary">{formatDateEN(d)}</Link>
                <span className="flex gap-1">{extra.includes(d) && <StatusPill tone="blue">B2B</StatusPill>}<StatusPill tone="gray">frozen</StatusPill></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Any date" className="mt-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (isValidISODate(custom)) window.location.href = `/admin/production/bake-day/${custom}`; }}
        >
          <label className="block">
            <span className="block text-xs text-smitten-text/60 mb-1">Bake day</span>
            <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className={inputCls} />
          </label>
          <button type="submit" className={btnSecondary} disabled={!isValidISODate(custom)}>Open</button>
          {isValidISODate(custom) && !isBakeDay(custom) && <span className="text-xs text-amber-700">Not a shop day (Wednesday / Saturday) — only B2B and one-off orders.</span>}
        </form>
      </Card>

      <Card title="At a glance" className="mt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Recipes" value={data.recipes.filter((r) => r.kind === 'dough').length} sub={`${data.recipes.filter((r) => r.kind === 'sub').length} sub-recipes`} href="/admin/production/recipes" />
          <Stat label="Ingredients" value={data.ingredients.length} href="/admin/production/ingredients" />
          <Stat label="Products" value={data.products.length} sub={`${data.products.filter((p) => p.channel === 'web').length} web · ${data.products.filter((p) => p.channel === 'intern').length} internal`} href="/admin/production/products" />
          <Stat label="Starters" value={data.starters.length} href="/admin/production/settings" />
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: number; sub?: string; href: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-smitten-cream p-3 hover:bg-smitten-cream/50">
      <p className="text-xs uppercase tracking-wider text-smitten-text/50">{label}</p>
      <p className="text-2xl font-display font-bold text-smitten-text">{value}</p>
      {sub && <p className="text-xs text-smitten-text/50">{sub}</p>}
    </Link>
  );
}
