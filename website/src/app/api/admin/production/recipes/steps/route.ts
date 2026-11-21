import { NextRequest, NextResponse } from 'next/server';
import { withAdmin, bad } from '@/lib/production/api';
import { saveRecipeSteps } from '@/lib/production/data';
import { normalizeSteps } from '@/lib/production/recipeSteps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/production/recipes/steps { id, steps } → saves method + planning (no new recipe version). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id || typeof body.id !== 'string') return bad('id is required.');
  const steps = normalizeSteps(body.steps);
  return withAdmin(req, async (db) => {
    await saveRecipeSteps(db, body.id, steps);
    return NextResponse.json({ ok: true, steps });
  });
}
