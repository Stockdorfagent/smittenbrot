import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { localDateISO } from '@/lib/pickup';
import type { Closure } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';

export function ClosureBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  banner: {
    backgroundColor: colors.strip,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: colors.onStrip,
    textAlign: 'center',
    fontWeight: '500',
  },
});
