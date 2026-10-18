import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { withAdmin } from '@/lib/production/api';
import { exportCsv, loadProductionData } from '@/lib/production/data';
import { berlinTodayISO } from '@/lib/production/bakeDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/production/export → zip with the four CSV files (backup, same format as the import). */
export async function GET(req: NextRequest) {
  return withAdmin(req, async (db) => {
    const data = await loadProductionData(db);
    const files = exportCsv(data);
    const zip = new JSZip();
    for (const [name, text] of Object.entries(files)) zip.file(`${name}.csv`, '﻿' + text);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${berlinTodayISO()}_recipes-backup.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
