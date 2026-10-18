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

/** Display rounding (spec 1.3 step 6): whole grams, one decimal under 10 g so 0.5 g yeast does not read as 0. */
export function fmtG(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 10) return (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });
  return Math.round(n).toLocaleString('en-GB');
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: 4 });
}
