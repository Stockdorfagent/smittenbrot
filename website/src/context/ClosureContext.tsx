'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { berlinTodayISO, ClosureRange } from '@/lib/pickup';

/**
 * Schließzeiten for the shop (public read, RLS closures_read_all): every
 * closure that has not ended yet. Loaded once per page load and shared by
 * the banner, the shop pages, the cart and the checkout, so all of them skip
 * the same closed pickup days and show the same banner.
 *
 * `loaded` is false until the read has returned: the pages wait for it
 * before deriving a pickup date, otherwise a closed date would flash first
 * and the product list would reload. A failed read yields [] (calendar rule)
 * — the server refuses a closed date anyway.
 */
interface ClosureState {
  closures: ClosureRange[];
  loaded: boolean;
}

const ClosureContext = createContext<ClosureState>({ closures: [], loaded: false });

export function ClosureProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClosureState>({ closures: [], loaded: false });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('closures')
      .select('start_date, end_date, banner_text_de, reason')
      .gte('end_date', berlinTodayISO())
      .order('start_date', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('[closures] fetch error:', error);
        setState({ closures: (data ?? []) as ClosureRange[], loaded: true });
      });
    return () => { cancelled = true; };
  }, []);

  return <ClosureContext.Provider value={state}>{children}</ClosureContext.Provider>;
}

export function useClosures(): ClosureState {
  return useContext(ClosureContext);
}
