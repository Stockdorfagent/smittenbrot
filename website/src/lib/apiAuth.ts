import { NextRequest, NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'sophia@smittenbrot.de';

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the authenticated user from the request's Bearer token by verifying
 * it against Supabase Auth. Returns null if absent or invalid.
 */
async function resolveUser(req: NextRequest): Promise<User | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/**
 * Require any logged-in user. Use for customer-facing routes that then do
 * their own ownership check. Returns { user } on success, or { response }
 * (a 401) to be returned immediately by the caller.
 */
export async function requireUser(
  req: NextRequest
): Promise<{ user: User } | { response: NextResponse }> {
  const user = await resolveUser(req);
  if (!user) {
    return { response: NextResponse.json({ error: 'Nicht autorisiert – bitte anmelden.' }, { status: 401 }) };
  }
  return { user };
}

/**
 * Require the admin user (matches ADMIN_EMAIL). Returns { user } on success,
 * or { response } (401 if not logged in, 403 if logged in but not admin).
 */
export async function requireAdmin(
  req: NextRequest
): Promise<{ user: User } | { response: NextResponse }> {
  const user = await resolveUser(req);
  if (!user) {
    return { response: NextResponse.json({ error: 'Nicht autorisiert – bitte anmelden.' }, { status: 401 }) };
  }
  if (!isAdminEmail(user.email)) {
    return { response: NextResponse.json({ error: 'Kein Admin-Zugriff.' }, { status: 403 }) };
  }
  return { user };
}
