import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '@/lib/theme';

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

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
  },
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  buttonDisabled: {
    backgroundColor: theme.colors.border,
  },
  buttonText: {
    fontSize: 18,
    color: theme.colors.white,
    fontWeight: '600',
  },
  buttonTextDisabled: {
    color: theme.colors.textLight,
  },
  quantity: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.sm,
  },
});
