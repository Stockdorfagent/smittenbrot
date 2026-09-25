import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { theme } from '@/lib/theme';

/**
 * Thin black strip announcing the welcome code — the app twin of the website's
 * PromoBanner (owner, 25.09.2026). Shown only while the code is usable for THIS
 * person: hidden once they have used it, and for everyone once the code is
 * inactive, expired or exhausted (retire it in Admin → Rabatte). The check is
 * the `discount_status` database function (migration 033).
 */
const PROMO: { text: string; code: string } | null = {
  text: 'Neu hier? 50 % Rabatt auf deine erste Bestellung mit dem Code',
  code: 'WILLKOMMEN26',
};

export function PromoStrip() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!PROMO) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.rpc('discount_status', { p_code: PROMO.code });
      const s = (data ?? {}) as { exists?: boolean; active?: boolean; expired?: boolean; exhausted?: boolean; used_by_me?: boolean };
      if (alive) setShow(Boolean(s.exists && s.active && !s.expired && !s.exhausted && !s.used_by_me));
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (!PROMO || !show) return null;
  return (
    <View style={styles.strip}>
      <Text style={styles.text}>
        {PROMO.text} <Text style={styles.code}>{PROMO.code}</Text>!
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { backgroundColor: theme.colors.text, paddingVertical: 8, paddingHorizontal: theme.spacing.md },
  text: { color: theme.colors.white, fontSize: theme.fontSize.xs, textAlign: 'center' },
  code: { color: theme.colors.primary, fontWeight: '700', letterSpacing: 0.5 },
});
