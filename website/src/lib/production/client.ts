'use client';

/**
 * Browser helpers for the production admin pages: authenticated calls to
 * /api/admin/production/* and reads through RLS.
 */
import { supabase } from '../supabase';
import { loadProductionData } from './data';
import type { ProductionData } from './types';

export async function adminFetch<T = unknown>(path: string, init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText || 'Request failed');
  return json as T;
}

/** Download a file from an authenticated route. */
export async function adminDownload(path: string, fallbackName: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || res.statusText);
  }
  const blob = await res.blob();
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return name;
}

export function loadData(): Promise<ProductionData> {
  return loadProductionData(supabase);
}

/**
 * Number display on the production pages — German format, FIXED decimals per
 * kind of figure (owner, 29.10.2026: "0, 1 or 2 decimals side by side reads
 * chaotic"): grams whole ("1.500"), one decimal under 10 g ("0,5" yeast, "0,8"
 * acerola); line percentages 2 decimals ("32,16"); sums whole; factors 2.
 */
const de = (n: number, d: number) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Whole grams, one decimal under 10 g (spec 1.3 step 6). */
export function fmtG(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  if (v === 0) return '0';
  return Math.abs(v) < 10 ? de(v, 1) : de(Math.round(v), 0);
}

/** A baker's percentage of one line: always 2 decimals. */
export function fmtPct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '';
  return de(Number(n), 2);
}

/** A sum of percentages (Σ): whole number — a calculation aid, not a figure to read precisely. */
export function fmtSum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return de(Math.round(Number(n)), 0);
}

/** Fixed decimals, e.g. margin factor 0,05 / 0,10. */
export function fmtDec(n: number | string | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || n === '') return '';
  return de(Number(n), decimals);
}
