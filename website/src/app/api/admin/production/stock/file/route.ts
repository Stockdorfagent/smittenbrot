import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/production/stock/file?path=invoices/2026/… → { url } (signed, 5 minutes). Admin only; the bucket is private. */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') ?? '';
  const m = /^invoices\/([\w\-./]+)$/.exec(path);
  if (!m || path.includes('..')) return bad('path must be invoices/…');
  return withAdmin(req, async (db) => {
    const { data, error } = await db.storage.from('invoices').createSignedUrl(m[1], 300);
    if (error) throw new Error(error.message);
    return NextResponse.json({ url: data.signedUrl });
  });
}
