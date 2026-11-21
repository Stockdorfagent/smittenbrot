import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { buildBackplan } from '@/lib/production/backplanXlsx';
import { isValidISODate } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/production/bake-day/xlsx?date=YYYY-MM-DD → the Backplan workbook
 * (Overview, Prep, one tab per recipe, Starters, Orders, Distribution — see
 * lib/production/backplanXlsx.ts). The range export /api/admin/production-plan is untouched.
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!isValidISODate(date)) return bad('date must be YYYY-MM-DD.');
  return withAdmin(req, async (db) => {
    const { buffer, filename } = await buildBackplan(db, date);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
