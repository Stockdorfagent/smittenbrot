import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { planImport } from '@/lib/production/csvImport';
import { commitImportPlan } from '@/lib/production/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/production/import
 *   { files: { ingredients, recipes, products, recipe_lines }, commit?: boolean, replace?: boolean }
 *   → { plan } (preview) or { plan, committed } after writing.
 * The planner never guesses: errors block the commit; "replace" wipes all pr_ recipe data first.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const f = body?.files;
  for (const k of ['ingredients', 'recipes', 'products', 'recipe_lines']) {
    if (!f || typeof f[k] !== 'string' || !f[k].trim()) return bad(`${k}.csv is missing.`);
  }
  return withAdmin(req, async (db) => {
    const { data: shop, error } = await db.from('products').select('id, name, unit_label, active');
    if (error) throw new Error(error.message);
    const plan = planImport(f, shop ?? []);
    if (!body.commit) return NextResponse.json({ plan });
    if (plan.errors.length) return NextResponse.json({ plan, error: 'The plan has errors; nothing was written.' }, { status: 422 });
    const committed = await commitImportPlan(db, plan, { replace: !!body.replace });
    return NextResponse.json({ plan, committed });
  });
}
