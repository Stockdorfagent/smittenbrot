'use client';

/** Browser side of the .xlsx exports: post the typed sheets to /api/admin/xlsx and save the file. */
import { supabase } from './supabase';
import type { XlsxSheet } from './xlsx';

export type { XlsxSheet, XlsxCol, XlsxColType } from './xlsx';

export async function downloadXlsx(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/admin/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ filename, sheets }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || res.statusText || 'Export fehlgeschlagen');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
