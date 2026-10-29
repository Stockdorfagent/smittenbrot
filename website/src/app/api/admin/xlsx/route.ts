import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { buildWorkbook, type XlsxSheet } from '@/lib/xlsx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/xlsx { filename, sheets: XlsxSheet[] } → the workbook as a file.
 * The admin pages already hold the rows (they query Supabase themselves);
 * exceljs needs node, so the file is written here. Admin only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  let body: { filename?: unknown; sheets?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON erwartet' }, { status: 400 }); }
  const filename = typeof body.filename === 'string' && /^[\w.\- äöüÄÖÜß]+\.xlsx$/.test(body.filename) ? body.filename : 'export.xlsx';
  const sheets = Array.isArray(body.sheets) ? (body.sheets as XlsxSheet[]) : [];
  if (sheets.length === 0 || sheets.some((s) => !s || typeof s.name !== 'string' || !Array.isArray(s.columns) || !Array.isArray(s.rows))) {
    return NextResponse.json({ error: 'sheets[] mit name, columns, rows erwartet' }, { status: 400 });
  }
  if (sheets.reduce((n, s) => n + s.rows.length, 0) > 50000) return NextResponse.json({ error: 'Zu viele Zeilen (max. 50.000)' }, { status: 400 });
  try {
    const bytes = await buildWorkbook(sheets);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // ASCII fallback + RFC 5987 UTF-8 name (the page sets a.download itself anyway).
        'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    console.error('xlsx export error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Export fehlgeschlagen' }, { status: 500 });
  }
}
