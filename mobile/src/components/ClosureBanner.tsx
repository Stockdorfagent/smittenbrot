import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { localDateISO } from '@/lib/pickup';
import type { Closure } from '@/lib/types';

export function ClosureBanner() {
  const [closure, setClosure] = useState<Closure | null>(null);

  useEffect(() => {
    // Device-local calendar date, not UTC: toISOString() still returns
    // yesterday between midnight and ~02:00 German time, which would show or
    // hide the banner a day off around the closure boundaries.
    const now = localDateISO(new Date());
    supabase
      .from('closures')
      .select('*')
      .lte('start_date', now)
      .gte('end_date', now)
      .maybeSingle()
      .then(({ data }) => setClosure(data));
  }, []);

  if (!closure) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{closure.banner_text_de}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.white,
    textAlign: 'center',
    fontWeight: '500',
  },
});
