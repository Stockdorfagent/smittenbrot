import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';
import { useMemo } from 'react';

interface CartBadgeProps {
  count: number;
}

export function CartBadge({ count }: CartBadgeProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  badge: {
    backgroundColor: colors.accent,
    borderRadius: theme.borderRadius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -4,
    right: -8,
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onAccent,
  },
});
