import { Modal, View, Text, ScrollView, Image, TouchableOpacity, StyleSheet, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { productInfoLines, splitDescription } from '@/lib/productInfo';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import type { Product } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';
import { useMemo, useState } from 'react';

/** `**Weizen**mehl` → bold "Weizen" (LMIV Art. 21 emphasis in the generated ingredient list, like the website). */
function emphasised(text: string, boldStyle: object) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <Text key={i} style={boldStyle}>{part.slice(2, -2)}</Text>
      : <Text key={i}>{part}</Text>,
  );
}

/**
 * Grey info block (weight / ingredients / allergens) rendered like the website:
 * Gewicht/Zutaten/Allergene labels bold, the "gleiche Backstube" disclaimer italic.
 */
function InfoBlock({ infoSection, styles }: { infoSection: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.infoBlock}>
      {infoSection.split('\n').map((line, i) => {
        if (/^(Gewicht|Zutaten|Allergene):/.test(line)) {
          const idx = line.indexOf(':');
          return (
            <Text key={i} style={styles.infoLine}>
              <Text style={styles.infoLabel}>{line.slice(0, idx + 1)}</Text>
              {emphasised(line.slice(idx + 1), styles.infoLabel)}
            </Text>
          );
        }
        if (line.startsWith('In der gleichen Backstube')) {
          return <Text key={i} style={[styles.infoLine, styles.infoItalic]}>{line}</Text>;
        }
        if (line.trim() === '') return <View key={i} style={{ height: 6 }} />;
        return <Text key={i} style={styles.infoLine}>{line}</Text>;
      })}
    </View>
  );
}

interface Props {
  product: Product | null;
  visible: boolean;
  onClose: () => void;
  onAdd: (product: Product) => void;
  /** Sold out for the upcoming pickup: the button is disabled and says so (onAdd would silently do nothing). */
  soldOut?: boolean;
}

export function ProductDetailModal({ product, visible, onClose, onAdd, soldOut = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  // Hooks before the early return: a hook after `return null` is skipped while the modal has
  // no product and runs once it has one → "Rendered more hooks than during the previous render".
  const [photoIndex, setPhotoIndex] = useState(0);
  if (!product) return null;

  const images = product.images && product.images.length > 0
    ? product.images
    : product.cover_image_url
      ? [product.cover_image_url]
      : [];

  const onPhotoScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== photoIndex) setPhotoIndex(Math.min(Math.max(i, 0), images.length - 1));
  };
  const mainDesc = splitDescription(product.description).main;
  const infoSection = productInfoLines(product);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.scroll}>
          {images.length > 0 ? (
            <View>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onPhotoScrollEnd}
                onScrollEndDrag={onPhotoScrollEnd}
              >
                {images.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={{ width, height: width }} resizeMode="cover" />
                ))}
              </ScrollView>
              {/* Page dots (owner 29.09.): nothing said "swipe for more photos". Only with 2+ photos. */}
              {images.length > 1 && (
                <View style={styles.dots} pointerEvents="none">
                  {images.map((_, i) => (
                    <View key={i} style={[styles.dot, i === photoIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.placeholder, { width, height: width }]}>
              <Text style={styles.placeholderText}>{product.name.charAt(0)}</Text>
            </View>
          )}

          <View style={styles.body}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.price}>{(product.price_cents / 100).toFixed(2).replace('.', ',')} €{product.unit_label?.trim() ? ` / ${product.unit_label.trim()}` : ''}</Text>
            </View>

            {mainDesc ? <Text style={styles.description}>{mainDesc}</Text> : null}

            <Button
              title={soldOut ? 'Ausverkauft' : 'In den Warenkorb'}
              onPress={() => { onAdd(product); onClose(); }}
              disabled={soldOut}
              size="lg"
              style={styles.addButton}
            />

            {infoSection ? <InfoBlock infoSection={infoSection} styles={styles} /> : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  closeBtn: {
    position: 'absolute',
    top: 44,
    right: 16,
    zIndex: 10,
    backgroundColor: colors.surface,
    borderRadius: 999,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  scroll: { paddingBottom: 48 },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)' },
  dotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  placeholder: { backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 72, color: colors.secondary },
  body: { padding: theme.spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.md },
  name: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: colors.text, flex: 1, marginRight: theme.spacing.md },
  price: { fontSize: theme.fontSize.xl, fontWeight: '700', color: colors.text },
  description: { fontSize: theme.fontSize.md, color: colors.text, lineHeight: 24 },
  addButton: { width: '100%', marginTop: theme.spacing.lg, marginBottom: theme.spacing.lg },
  infoBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: theme.spacing.lg,
  },
  infoLine: { fontSize: theme.fontSize.sm, color: colors.textLight, lineHeight: 21 },
  infoLabel: { fontWeight: '700', color: colors.textLight },
  infoItalic: { fontStyle: 'italic', marginTop: theme.spacing.xs },
});
