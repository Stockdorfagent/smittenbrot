'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Auth callback page — handles Supabase magic link redirects
 * (password reset, email confirmation, magic link sign-in).
 *
 * Supabase sends links like:
 *   /auth/callback#access_token=xxx&type=recovery&...
 *
 * This page preserves the hash fragment and redirects to /login
 * where the login page's Supabase client picks it up.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Preserve the full hash fragment and redirect to login
    const hash = window.location.hash;
    router.replace(`/login${hash}`);
  }, [router]);

  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center text-smitten-text/40">
      Weiterleitung...
    </div>
  );
}
