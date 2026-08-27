import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import type { Product } from '@/lib/types';

const { width } = Dimensions.get('window');

/**
 * Grey info block (weight / ingredients / allergens) rendered like the website:
 * Gewicht/Zutaten/Allergene labels bold, the "gleiche Backstube" disclaimer italic.
 */
function InfoBlock({ infoSection }: { infoSection: string }) {
  return (
    <View style={styles.infoBlock}>
      {infoSection.split('\n').map((line, i) => {
        if (/^(Gewicht|Zutaten|Allergene):/.test(line)) {
          const idx = line.indexOf(':');
          return (
            <Text key={i} style={styles.infoLine}>
              <Text style={styles.infoLabel}>{line.slice(0, idx + 1)}</Text>
              {line.slice(idx + 1)}
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
}

export function ProductDetailModal({ product, visible, onClose, onAdd }: Props) {
  if (!product) return null;

  const images = product.images && product.images.length > 0
    ? product.images
    : product.cover_image_url
      ? [product.cover_image_url]
      : [];

  const desc = product.description ?? '';
  const blankIndex = desc.indexOf('\n\n');
  const mainDesc = (blankIndex >= 0 ? desc.slice(0, blankIndex) : desc).trim();
  const infoSection = blankIndex >= 0 ? desc.slice(blankIndex + 2) : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.scroll}>
          {images.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {images.map((uri, i) => (
                <Image
                  key={i}
                  source={{ uri }}
                  style={{ width, height: width }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.placeholder, { width, height: width }]}>
              <Text style={styles.placeholderText}>{product.name.charAt(0)}</Text>
            </View>
          )}

          <View style={styles.body}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.price}>{(product.price_cents / 100).toFixed(2).replace('.', ',')} €</Text>
            </View>

            {mainDesc ? <Text style={styles.description}>{mainDesc}</Text> : null}

            <Button
              title="In den Warenkorb"
              onPress={() => { onAdd(product); onClose(); }}
              size="lg"
              style={styles.addButton}
            />

            {infoSection ? <InfoBlock infoSection={infoSection} /> : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  closeBtn: {
    position: 'absolute',
    top: 44,
    right: 16,
    zIndex: 10,
    backgroundColor: theme.colors.white,
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
  placeholder: { backgroundColor: theme.colors.cream, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 72, color: theme.colors.secondary },
  body: { padding: theme.spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.md },
  name: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.colors.text, flex: 1, marginRight: theme.spacing.md },
  price: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text },
  description: { fontSize: theme.fontSize.md, color: theme.colors.text, lineHeight: 24 },
  addButton: { width: '100%', marginTop: theme.spacing.lg, marginBottom: theme.spacing.lg },
  infoBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.lg,
  },
  infoLine: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, lineHeight: 21 },
  infoLabel: { fontWeight: '700', color: theme.colors.textLight },
  infoItalic: { fontStyle: 'italic', marginTop: theme.spacing.xs },
});
