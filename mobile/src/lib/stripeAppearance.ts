import type { PaymentSheet } from '@stripe/stripe-react-native';
import { darkColors, lightColors } from '@/lib/theme';

/**
 * Stripe's PaymentSheet does not follow our palette by itself; it gets the
 * matching colours here (brand red as primary, otherwise black/white/greys).
 */
export function paymentSheetAppearance(isDark: boolean): PaymentSheet.AppearanceParams {
  const c = isDark ? darkColors : lightColors;
  return {
    colors: {
      primary: c.primary,
      background: c.background,
      componentBackground: c.surface,
      componentBorder: c.border,
      componentDivider: c.border,
      primaryText: c.text,
      secondaryText: c.textLight,
      componentText: c.text,
      placeholderText: c.textLight,
      icon: c.textLight,
      error: c.error,
    },
    shapes: { borderRadius: 12 },
    primaryButton: { colors: { background: c.primary, text: c.onPrimary } },
  };
}
