/**
 * Boilerplate shared by every /api/admin/production/* route: admin check
 * (server-side, spec §0), service-role client, uniform error JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '../apiAuth';

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function withAdmin(req: NextRequest, fn: (db: SupabaseClient, adminEmail: string) => Promise<NextResponse>): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  try {
    return await fn(serviceClient(), auth.user.email ?? '');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
