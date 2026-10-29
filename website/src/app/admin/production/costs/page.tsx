'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StatusPill } from '@/components/admin/StatusPill';
import { showToast } from '@/components/admin/toast';
import { Card, Notice, PageHeader, SubNav, smallInputCls, th, td, tdNum } from '@/components/admin/production/ui';
import { adminFetch, fmtG } from '@/lib/production/client';
import { parseEuro } from '@/lib/production/stock';
import type { CostRow, PriceRow } from '@/app/api/admin/production/costs/route';

interface CostsResponse { products: CostRow[]; prices: PriceRow[] }

const eur = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (n: number) => `${Math.round(n)} %`;
const de = (ymd: string) => ymd.split('-').reverse().join('.');
const perKg = (centsPerUnit: number, unit: 'g' | 'pcs') => eur(unit === 'g' ? centsPerUnit * 1000 : centsPerUnit);

export default function CostsPage() {
  const [res, setRes] = useState<CostsResponse | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [b2b, setB2b] = useState<Record<string, string>>({});

  const load = () => adminFetch<CostsResponse>('/api/admin/production/costs').then((r) => {
    setRes(r);
    const f: Record<string, string> = {};
    for (const p of r.products) f[p.pr_product_id] = p.b2b_net_cents !== null ? (p.b2b_net_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '';
    setB2b(f);
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function saveB2b(id: string) {
    const cents = parseEuro(b2b[id] ?? '');
    if (Number.isNaN(cents)) { showToast('Not a price.'); return; }
    try { await adminFetch('/api/admin/production/costs', { body: { action: 'set_b2b_price', pr_product_id: id, cents } }); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!res) return <AdminLoading what="costs" />;

  const missing = [...new Set(res.products.flatMap((p) => p.missing))].sort();
  const margin = (cost: number, net: number | null) => (net === null || net <= 0 ? null : { cents: net - cost, pct: ((net - cost) / net) * 100 });
  const red = 'text-red-700 dark:text-red-400';

  return (
    <div>
      <PageHeader title="Costs" subtitle="Ingredient cost per unit sold, from the recipe and the latest delivery prices. Net prices without 7 % VAT. Dough margin and packaging not included." />
      <SubNav current="/admin/production/costs" />

      {missing.length > 0 && <div className="mb-4"><Notice tone="warning">No price yet: {missing.join(', ')} — <Link href="/admin/production/stock" className="underline">book a delivery</Link>. Products using them show a cost without these.</Notice></div>}

      <Card title="Products" className="mb-6">
        <table className="w-full">
          <thead><tr><th className={th}>Product</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>of which delivery</th><th className={`${th} text-right`}>Web net</th><th className={`${th} text-right`}>Margin</th><th className={`${th} text-right`}>B2B net</th><th className={`${th} text-right`}>Margin</th></tr></thead>
          <tbody>
            {res.products.map((p) => {
              const mw = margin(p.total_cents, p.web_net_cents);
              const mb = margin(p.total_cents, p.b2b_net_cents);
              const isOpen = open === p.pr_product_id;
              return [
                <tr key={p.pr_product_id} className="border-t border-smitten-cream">
                  <td className={td}><button className="text-left font-medium hover:text-smitten-primary" onClick={() => setOpen(isOpen ? null : p.pr_product_id)}>{p.name}</button>{p.blocked && <StatusPill tone="red">{p.blocked}</StatusPill>}{!p.blocked && p.missing.length > 0 && <span className={`ml-2 text-xs ${red}`}>incomplete</span>}</td>
                  <td className={`${tdNum} font-medium`}>{p.blocked ? '' : eur(p.total_cents)}</td>
                  <td className={`${tdNum} text-smitten-text/60`}>{p.blocked || p.delivery_cents === 0 ? '' : eur(p.delivery_cents)}</td>
                  <td className={tdNum}>{p.web_net_cents !== null ? eur(p.web_net_cents) : ''}</td>
                  <td className={`${tdNum} ${mw && mw.cents < 0 ? red : ''}`}>{mw && !p.blocked ? <>{eur(mw.cents)} <span className="text-xs text-smitten-text/50">{pct(mw.pct)}</span></> : ''}</td>
                  <td className={`${tdNum} whitespace-nowrap`}><input className={`${smallInputCls} w-20 text-right`} value={b2b[p.pr_product_id] ?? ''} placeholder="—" onChange={(e) => setB2b({ ...b2b, [p.pr_product_id]: e.target.value })} onBlur={() => { const v = b2b[p.pr_product_id] ?? ''; const cur = p.b2b_net_cents !== null ? (p.b2b_net_cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : ''; if (v !== cur) saveB2b(p.pr_product_id); }} /></td>
                  <td className={`${tdNum} ${mb && mb.cents < 0 ? red : ''}`}>{mb && !p.blocked ? <>{eur(mb.cents)} <span className="text-xs text-smitten-text/50">{pct(mb.pct)}</span></> : ''}</td>
                </tr>,
                isOpen && !p.blocked && (
                  <tr key={`${p.pr_product_id}-lines`} className="bg-smitten-cream/30">
                    <td className={td} colSpan={7}>
                      <table className="text-xs">
                        <tbody>{p.lines.map((l) => (
                          <tr key={l.ingredient_id}><td className="pr-4 py-0.5">{l.name}</td><td className="pr-4 py-0.5 text-right tabular-nums">{fmtG(l.amount)} {l.unit}</td><td className={`pr-4 py-0.5 text-right tabular-nums ${l.goods_cents === null ? red : ''}`}>{l.goods_cents === null ? 'no price' : eur(l.goods_cents + (l.delivery_cents ?? 0))}</td></tr>
                        ))}</tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Ingredient prices">
        {res.prices.length === 0 ? <p className="text-sm text-smitten-text/50">No booked deliveries yet.</p> : (
          <table className="w-full">
            <thead><tr><th className={th}>Ingredient</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Delivery</th><th className={`${th} text-right`}>Before</th><th className={th}>Supplier</th><th className={th}>Date</th></tr></thead>
            <tbody>
              {res.prices.map((p) => {
                const change = p.previous_unit_price ? ((p.unit_price - p.previous_unit_price) / p.previous_unit_price) * 100 : null;
                const unitLabel = p.unit === 'g' ? '/kg' : '/pc';
                return (
                  <tr key={p.ingredient_id} className="border-t border-smitten-cream">
                    <td className={`${td} font-medium`}>{p.name}</td>
                    <td className={tdNum}>{perKg(p.unit_price, p.unit)}<span className="text-xs text-smitten-text/50">{unitLabel}</span></td>
                    <td className={`${tdNum} text-smitten-text/60`}>{p.delivery_share > 0 ? perKg(p.delivery_share, p.unit) : ''}</td>
                    <td className={`${tdNum} ${change !== null && change > 0 ? red : ''}`}>{p.previous_unit_price !== null ? <>{perKg(p.previous_unit_price, p.unit)} <span className="text-xs">{change !== null && change !== 0 ? `${change > 0 ? '+' : ''}${Math.round(change)} %` : ''}</span></> : ''}</td>
                    <td className={td}>{p.supplier ?? ''}</td>
                    <td className={`${td} text-smitten-text/60`}>{de(p.date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
