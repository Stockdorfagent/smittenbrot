import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/production/settings  { dough_margin_factor, build_margin_pct, final_build_margin_pct } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dmf = Number(body?.dough_margin_factor);
  const bmp = Number(body?.build_margin_pct);
  const fbm = Number(body?.final_build_margin_pct);
  if (!(dmf >= 0) || !(bmp >= 0) || !(fbm >= 0)) return bad('All three defaults must be numbers ≥ 0.');
  return withAdmin(req, async (db) => {
    const { error } = await db.from('pr_settings').upsert({ id: 1, dough_margin_factor: dmf, build_margin_pct: bmp, final_build_margin_pct: fbm, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
