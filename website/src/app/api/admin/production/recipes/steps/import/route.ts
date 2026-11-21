import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { withAdmin, bad } from '@/lib/production/api';
import { parseStepsRows } from '@/lib/production/recipeSteps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/production/recipes/steps/import  (multipart: file = the owner's recipe-steps .xlsx)
 *   → { name, steps }   — nothing is saved; the editor shows the result and the owner saves.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('file is required.');
  if (file.size > 5 * 1024 * 1024) return bad('File larger than 5 MB.');
  return withAdmin(req, async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return bad('The workbook has no sheet.');
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, i) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v));
      rows[i - 1] = vals;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return NextResponse.json(parseStepsRows(rows));
  });
}
