import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';
import { useMemo } from 'react';
import { localDateISO, announcedClosure, closureBannerText } from '@/lib/pickup';
import { useClosures } from '@/context/ClosureContext';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';

/**
 * Schließzeit banner on the start screen. Since 20.11.2026 it appears 14 days
 * BEFORE the closure starts (not only while it runs), because that is when
 * the app already skips the closed pickup days and customers need to know
 * why. Text: the owner's banner text, or a generated one naming the dates
 * and the first bake day after the closure.
 */
export function ClosureBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { closures, loaded } = useClosures();

  if (!loaded) return null;
  // Device-local calendar date, not UTC: toISOString() still returns
  // yesterday between midnight and ~02:00 German time.
  const closure = announcedClosure(closures, localDateISO(new Date()));
  if (!closure) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{closureBannerText(closure, closures)}</Text>
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
