import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { localDateISO } from '@/lib/pickup';
import type { ClosureRange } from '@/lib/pickup';

/**
 * Schließzeiten for the app (public read, RLS closures_read_all): every
 * closure that has not ended yet. One read at start, refreshed by the start
 * screen on focus / pull-to-refresh, shared by the banner, the start screen,
 * the cart and the checkout so all of them skip the same closed pickup days.
 *
 * `loaded` is false until the first read has returned. A failed read keeps
 * the previous list (or []), which is the plain calendar rule — the server
 * refuses a closed date anyway.
 */
interface ClosureState {
  closures: ClosureRange[];
  loaded: boolean;
  /** Re-read the closures; resolves with the fresh list. */
  refresh: () => Promise<ClosureRange[]>;
}

const ClosureContext = createContext<ClosureState>({ closures: [], loaded: false, refresh: async () => [] });

export function ClosureProvider({ children }: { children: ReactNode }) {
  const [closures, setClosures] = useState<ClosureRange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<ClosureRange[]>([]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('closures')
      .select('start_date, end_date, banner_text_de, reason')
      .gte('end_date', localDateISO(new Date()))
      .order('start_date', { ascending: true });
    if (!error && data) {
      latest.current = data as ClosureRange[];
      setClosures(latest.current);
    }
    setLoaded(true);
    return latest.current;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ClosureContext.Provider value={{ closures, loaded, refresh }}>
      {children}
    </ClosureContext.Provider>
  );
}

export function useClosures(): ClosureState {
  return useContext(ClosureContext);
}
