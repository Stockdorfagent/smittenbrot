/**
 * Server-side .xlsx builder for the admin exports (owner, 29.10.2026: CSV does
 * not open cleanly in German Excel — columns have to be split by hand). Typed
 * columns so Excel gets real numbers, euro amounts and dates: cents become
 * € with two decimals, YYYY-MM-DD becomes a date cell shown as dd.mm.yyyy.
 * Bold header row, frozen, auto-filter, sensible widths. Node only (exceljs).
 */
import ExcelJS from 'exceljs';

export type XlsxColType = 'text' | 'int' | 'num' | 'euro' | 'date' | 'pct';
export interface XlsxCol { header: string; key: string; type?: XlsxColType; width?: number }
export interface XlsxSheet {
  name: string;
  columns: XlsxCol[];
  rows: Record<string, unknown>[];
  /** Optional lines above the table (title, period…); the table starts after a blank row. */
  intro?: string[];
  /** Optional label/value block below the table (totals, checks). */
  footer?: [string, unknown, XlsxColType?][];
}

const FORMATS: Record<XlsxColType, string | undefined> = {
  text: undefined, int: '0', num: '#,##0.00', euro: '#,##0.00 "€"', date: 'dd.mm.yyyy', pct: '0 %',
};

function cellValue(v: unknown, type: XlsxColType): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'euro': return Number(v) / 100;                 // cents in, euro out
    case 'int': case 'num': case 'pct': return Number(v);
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(v);
    }
    default: return String(v);
  }
}

const safeName = (n: string) => n.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Daten';

export async function buildWorkbook(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smittenbrot';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(safeName(s.name));
    let headerRow = 1;
    for (const line of s.intro ?? []) { const r = ws.addRow([line]); r.font = { bold: headerRow === 1, size: headerRow === 1 ? 13 : 11 }; headerRow++; }
    if (s.intro?.length) { ws.addRow([]); headerRow++; }
    const head = ws.addRow(s.columns.map((c) => c.header));
    head.font = { bold: true };
    head.alignment = { vertical: 'middle' };
    head.border = { bottom: { style: 'thin' } };
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.max(10, Math.min(48, c.header.length + 4));
      const fmt = FORMATS[c.type ?? 'text'];
      if (fmt) col.numFmt = fmt;
      if (c.type && c.type !== 'text' && c.type !== 'date') col.alignment = { horizontal: 'right' };
    });
    for (const row of s.rows) {
      const r = ws.addRow(s.columns.map((c) => cellValue(row[c.key], c.type ?? 'text')));
      s.columns.forEach((c, i) => { const fmt = FORMATS[c.type ?? 'text']; if (fmt) r.getCell(i + 1).numFmt = fmt; });
    }
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    if (s.rows.length > 0) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + s.rows.length, column: s.columns.length } };
    // Text columns: widen to the longest value (capped) so names and item lists are readable.
    s.columns.forEach((c, i) => {
      if (c.width || (c.type && c.type !== 'text')) return;
      const longest = s.rows.reduce((m, r) => Math.max(m, String(r[c.key] ?? '').length), c.header.length);
      ws.getColumn(i + 1).width = Math.max(10, Math.min(60, longest + 2));
    });
    if (s.footer?.length) {
      ws.addRow([]);
      ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 10, ...s.footer.map(([l]) => l.length + 2));
      ws.getColumn(2).width = Math.max(ws.getColumn(2).width ?? 10, 16);
      for (const [label, value, type] of s.footer) {
        const r = ws.addRow([label, cellValue(value, type ?? 'text')]);
        r.getCell(1).font = { bold: true };
        r.getCell(1).numFmt = 'General';                  // not the table column's date/€ format
        r.getCell(2).numFmt = FORMATS[type ?? 'text'] ?? 'General';
        r.getCell(2).alignment = { horizontal: 'left' };
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
