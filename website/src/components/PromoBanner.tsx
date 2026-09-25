'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Thin black bar above the navigation announcing the welcome code (owner,
 * 11.09.2026 — the Squarespace site had the same kind of strip). Brand palette:
 * black background, white text, the code in brand red.
 *
 * Since 25.09.2026 it asks the `discount_status` database function: hidden for
 * a logged-in customer who has already used the code, and for everyone once the
 * code is inactive, expired or exhausted — so retiring it is a switch in
 * Admin → Rabatte, no deploy. Set PROMO to null to remove it for good.
 */
const PROMO: { text: string; code: string } | null = {
  text: 'Neu hier? 50 % Rabatt auf deine erste Bestellung mit dem Code',
  code: 'WILLKOMMEN26',
};

export default function PromoBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!PROMO) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.rpc('discount_status', { p_code: PROMO.code });
      const s = (data ?? {}) as { exists?: boolean; active?: boolean; expired?: boolean; exhausted?: boolean; used_by_me?: boolean };
      if (alive) setShow(Boolean(s.exists && s.active && !s.expired && !s.exhausted && !s.used_by_me));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      supabase.rpc('discount_status', { p_code: PROMO.code }).then(({ data }) => {
        const s = (data ?? {}) as { exists?: boolean; active?: boolean; expired?: boolean; exhausted?: boolean; used_by_me?: boolean };
        if (alive) setShow(Boolean(s.exists && s.active && !s.expired && !s.exhausted && !s.used_by_me));
      });
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  if (!PROMO || !show) return null;
  return (
    <div className="bg-black text-white text-center px-4 py-2 text-xs sm:text-sm">
      {PROMO.text}{' '}
      <span className="font-bold tracking-wide text-smitten-primary">{PROMO.code}</span>!
    </div>
  );
}
