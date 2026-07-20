'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Detects Supabase auth hash fragments (password reset, email confirmation)
 * anywhere on the site and redirects to /login with the hash preserved.
 *
 * Supabase sends links like:
 *   /#access_token=xxx&type=recovery&...
 * or
 *   /auth/callback#access_token=xxx&type=recovery&...
 *
 * Both end up here — we forward them to /login where the Supabase client
 * picks them up.
 */
export default function AuthHashHandler() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    const path = window.location.pathname;
    if (hash && (hash.includes('type=recovery') || hash.includes('type=signup') || hash.includes('access_token'))) {
      // Already on /login — let the login page handle it directly
      if (path === '/login') return;
      // Full page navigation so Supabase client re-initializes and picks up the hash
      window.location.href = `/login${hash}`;
    }
  }, [router]);

  return null;
}
