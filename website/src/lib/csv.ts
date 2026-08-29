/**
 * CSV helpers for the admin exports — the escaping block and the
 * BOM/Blob/anchor dance existed as verbatim copies (one of which had lost its
 * BOM, so ONE export opened with broken umlauts in Excel and the others
 * didn't).
 */

function escapeCell(val: unknown): string {
  const str = String(val ?? '');
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

/** Comma-separated CSV from uniform objects; header row from the first row's keys. */
export function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ].join('\n');
}

/** Download `csv` as `filename`, always with the BOM Excel needs for umlauts. */
export function downloadCsv(filename: string, csv: string): void {
  const bom = csv.startsWith('﻿') ? '' : '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
