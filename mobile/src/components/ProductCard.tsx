import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { theme } from '@/lib/theme';
import type { Product } from '@/lib/types';

interface ProductCardProps {
  product: Product;
  available: boolean;
  onAddToCart: () => void;
  quantity?: number;
}

export function ProductCard({ product, available, onAddToCart, quantity = 0 }: ProductCardProps) {
  const soldOut = !available || (product.capacity > 0 && quantity >= product.capacity);

  return (
    <TouchableOpacity style={styles.card} onPress={onAddToCart} activeOpacity={0.7} disabled={soldOut}>
      {product.cover_image_url ? (
        <Image source={{ uri: product.cover_image_url }} style={styles.image} />
      ) : (
        <View style={[styles.imagePlaceholder]}>
          <Text style={styles.placeholderText}>{product.name.charAt(0)}</Text>
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.price}>{product.price_cents / 100}€</Text>
        {soldOut ? (
          <View style={styles.soldOutBadge}>
            <Text style={styles.soldOutText}>Ausverkauft</Text>
          </View>
        ) : (
          <Text style={styles.capacity}>
            {quantity > 0 ? `+${quantity}` : 'In den Warenkorb'}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  image: {
    width: '100%',
    height: 140,
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: theme.colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 48,
    color: theme.colors.secondary,
    fontFamily: theme.fontFamily.display,
  },
  content: {
    padding: theme.spacing.md,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  price: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.secondary,
    fontWeight: '500',
  },
  soldOutBadge: {
    backgroundColor: theme.colors.soldOut,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: theme.spacing.sm,
  },
  soldOutText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.white,
    fontWeight: '600',
  },
  capacity: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
    marginTop: theme.spacing.sm,
    fontWeight: '500',
  },
});
