import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { QuantitySelector } from '@/components/QuantitySelector';
import type { Product } from '@/lib/types';

interface ProductCardProps {
  product: Product;
  available: boolean;
  onPress?: () => void; // opens the product detail
  quantity?: number;
  onIncrease?: () => void;
  onDecrease?: () => void;
  onAdd?: () => void;
}

export function ProductCard({
  product,
  available,
  onPress,
  quantity = 0,
  onIncrease,
  onDecrease,
  onAdd,
}: ProductCardProps) {
  const soldOut = !available;
  const showControls = !soldOut && !!onIncrease;

  /**
   * Nothing in the basket yet: offer one button that puts it there. Once it is
   * in, the stepper takes over and edits the basket directly — there is no
   * separate "add" step to press afterwards.
   *
   * A tester pointed out that adding several products meant setting a quantity
   * and then confirming it, product after product. The confirmation was the
   * redundant part: what the card shows IS what the basket holds, so a stepper
   * with nothing to commit is both fewer taps and one less thing to explain.
   * (It also removes a real inconsistency — the card used to reset to 0 after
   * adding, while the basket held 3.)
   */

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={onPress ? 0.85 : 1} onPress={onPress} disabled={!onPress}>
        {product.cover_image_url ? (
          <Image
            source={{ uri: product.cover_image_url }}
            style={styles.image}
            /* Storage serves these with `cache-control: no-cache`, and that
               cannot be changed on this project — so the app has to do the
               caching itself. expo-image keeps them on disk regardless, which
               turns a repeat visit from ~2.8 MB into nothing at all. */
            cachePolicy="memory-disk"
            contentFit="cover"
            /* Without this the picture appears in one jump after a grey gap,
               which is what "slow to load" usually means. */
            transition={200}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.placeholderText}>{product.name.charAt(0)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>{product.name}</Text>
          <Text style={styles.price}>{(product.price_cents / 100).toFixed(2).replace('.', ',')} €</Text>
        </View>

        {soldOut ? (
          <View style={styles.soldOutBadge}>
            <Text style={styles.soldOutText}>Ausverkauft</Text>
          </View>
        ) : showControls ? (
          <View style={styles.controls}>
            {quantity > 0 ? (
              <QuantitySelector quantity={quantity} onIncrease={onIncrease!} onDecrease={onDecrease!} />
            ) : (
              <Button
                title="In den Warenkorb"
                onPress={onAdd ?? onIncrease!}
                size="sm"
                style={styles.addButton}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  image: { width: '100%', height: 180, resizeMode: 'cover' },
  imagePlaceholder: {
    width: '100%',
    height: 180,
    backgroundColor: theme.colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 48, color: theme.colors.secondary },
  content: { padding: theme.spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text, flex: 1, marginRight: theme.spacing.sm },
  price: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.md },
  addButton: { flex: 1 },
  soldOutBadge: {
    backgroundColor: theme.colors.soldOut,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: theme.spacing.sm,
  },
  soldOutText: { fontSize: theme.fontSize.xs, color: theme.colors.white, fontWeight: '600' },
});
