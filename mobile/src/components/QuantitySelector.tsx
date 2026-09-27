import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';
import { useMemo } from 'react';

interface QuantitySelectorProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  min?: number;
  max?: number;
}

export function QuantitySelector({
  quantity,
  onIncrease,
  onDecrease,
  min = 0,
  max = 99,
}: QuantitySelectorProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, quantity <= min && styles.buttonDisabled]}
        onPress={onDecrease}
        disabled={quantity <= min}
      >
        <Text style={[styles.buttonText, quantity <= min && styles.buttonTextDisabled]}>−</Text>
      </TouchableOpacity>
      <Text style={styles.quantity}>{quantity}</Text>
      <TouchableOpacity
        style={[styles.button, quantity >= max && styles.buttonDisabled]}
        onPress={onIncrease}
        disabled={quantity >= max}
      >
        <Text style={[styles.buttonText, quantity >= max && styles.buttonTextDisabled]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
  },
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  buttonText: {
    fontSize: 18,
    color: colors.white,
    fontWeight: '600',
  },
  buttonTextDisabled: {
    color: colors.textLight,
  },
  quantity: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: theme.spacing.sm,
  },
});
