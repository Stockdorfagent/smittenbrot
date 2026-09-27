/**
 * Design tokens. Since 27.09.2026 the colours come in two palettes (light /
 * dark) — brand rule unchanged: bright red as the only accent, otherwise
 * white, black and greys; no red tints. Screens read the active palette
 * through `useTheme()` (src/context/ThemeContext.tsx) and build their
 * StyleSheet from it. `theme.colors` stays as the light palette for the few
 * non-React call sites.
 */
export interface ThemeColors {
  primary: string;      // brand red, the only accent
  onPrimary: string;    // text on a red or dark button
  secondary: string;
  accent: string;       // strong button (black in light, light grey in dark)
  onAccent: string;     // text on `accent`
  background: string;   // screen
  surface: string;      // cards, inputs, tab bar (was `white`)
  cream: string;        // secondary surface / subtle borders
  text: string;
  textLight: string;
  white: string;        // real white — text on red/dark, never a surface
  error: string;
  success: string;
  border: string;
  soldOut: string;
  strip: string;        // promo strip / closure banner background
  onStrip: string;
}

export const lightColors: ThemeColors = {
  primary: '#f8120e',
  onPrimary: '#FFFFFF',
  secondary: '#6B7280',
  accent: '#1A1A1A',
  onAccent: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  cream: '#F3F4F6',
  text: '#1A1A1A',
  textLight: '#6B7280',
  white: '#FFFFFF',
  error: '#DC2626',
  success: '#16A34A',
  border: '#E5E7EB',
  soldOut: '#9CA3AF',
  strip: '#000000',
  onStrip: '#FFFFFF',
};

export const darkColors: ThemeColors = {
  primary: '#f8120e',
  onPrimary: '#FFFFFF',
  secondary: '#9CA3AF',
  accent: '#F3F4F6',
  onAccent: '#111111',
  background: '#0F0F0F',
  surface: '#1C1C1E',
  cream: '#232326',
  text: '#F5F5F5',
  textLight: '#A1A1AA',
  white: '#FFFFFF',
  error: '#F87171',
  success: '#4ADE80',
  border: '#2E2E32',
  soldOut: '#6B7280',
  strip: '#1C1C1E',
  onStrip: '#F5F5F5',
};

export const theme = {
  /** Light palette — prefer `useTheme().colors` inside components. */
  colors: lightColors,
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 999,
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    hero: 36,
  },
  fontFamily: {
    display: 'System',
    body: 'System',
  },
};
