import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/Button';
import { ProductCard } from '@/components/ProductCard';
import { QuantitySelector } from '@/components/QuantitySelector';
import type { Product, WeekCycle, ProductCycle } from '@/lib/types';
import type { PickupDay } from '@/lib/types';

export default function ShopScreen() {
  const router = useRouter();
  const { addItem, items, itemCount } = useCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [weekCycle, setWeekCycle] = useState<WeekCycle | null>(null);
  const [selectedDay, setSelectedDay] = useState<PickupDay>('wednesday');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showQuantityModal, setShowQuantityModal] = useState<string | null>(null);

  const getFulfillmentDate = useCallback((day: PickupDay) => {
    const now = new Date();
    const dayNum = day === 'wednesday' ? 3 : 6;
    const target = new Date(now);
    target.setDate(now.getDate() + ((dayNum - now.getDay() + 7) % 7));
    if (target <= now) target.setDate(target.getDate() + 7);
    return target.toISOString().split('T')[0];
  }, []);

  const fetchProducts = useCallback(async () => {
    const { data: cycle } = await supabase.from('week_cycle').select('*').maybeSingle();
    setWeekCycle(cycle);

    const { data: allProducts } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (!allProducts) return;

    const filtered = allProducts.filter((p) => {
      if (p.cycle === 'hidden') return false;
      if (selectedDay === 'wednesday' && !p.available_wed) return false;
      if (selectedDay === 'saturday' && !p.available_sat) return false;
      if (p.cycle === 'week_a' && cycle?.current_week !== 'A') return false;
      if (p.cycle === 'week_b' && cycle?.current_week !== 'B') return false;
      return true;
    });

    setProducts(filtered);
  }, [selectedDay]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleAddToCart = (product: Product) => {
    const qty = quantities[product.id] || 1;
    if (qty > 10) {
      Alert.alert(
        'Mengenbestätigung',
        `Du hast ${qty}× ${product.name} ausgewählt. Ist das korrekt?`,
        [
          { text: 'Menge ändern', style: 'cancel' },
          {
            text: 'Ja',
            onPress: () => {
              addItem({ product_id: product.id, product_name: product.name, quantity: qty, unit_price_cents: product.price_cents });
              setQuantities((prev) => ({ ...prev, [product.id]: 0 }));
            },
          },
        ]
      );
    } else {
      addItem({ product_id: product.id, product_name: product.name, quantity: qty, unit_price_cents: product.price_cents });
      setQuantities((prev) => ({ ...prev, [product.id]: 0 }));
    }
  };

  const pickupDate = getFulfillmentDate(selectedDay);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Unser Sortiment</Text>
          <Text style={styles.subtitle}>
            {weekCycle && `Woche ${weekCycle.current_week} · `}
            Abholung {selectedDay === 'wednesday' ? 'Mittwoch' : 'Samstag'}
          </Text>
        </View>

        <View style={styles.dayToggle}>
          <TouchableOpacity
            style={[styles.dayButton, selectedDay === 'wednesday' && styles.dayButtonActive]}
            onPress={() => setSelectedDay('wednesday')}
          >
            <Text style={[styles.dayText, selectedDay === 'wednesday' && styles.dayTextActive]}>
              Mittwoch
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dayButton, selectedDay === 'saturday' && styles.dayButtonActive]}
            onPress={() => setSelectedDay('saturday')}
          >
            <Text style={[styles.dayText, selectedDay === 'saturday' && styles.dayTextActive]}>
              Samstag
            </Text>
          </TouchableOpacity>
        </View>

        {products.map((product) => {
          const qty = quantities[product.id] || 0;
          return (
            <View key={product.id} style={styles.productRow}>
              <ProductCard
                product={product}
                available
                onAddToCart={() => handleAddToCart(product)}
                quantity={qty}
              />
              <View style={styles.quantityRow}>
                <QuantitySelector
                  quantity={qty}
                  onIncrease={() => setQuantities((prev) => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }))}
                  onDecrease={() => setQuantities((prev) => ({ ...prev, [product.id]: Math.max(0, (prev[product.id] || 0) - 1) }))}
                />
                {qty > 0 && (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAddToCart(product)}
                  >
                    <Text style={styles.addText}>+ Zum Warenkorb</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {itemCount > 0 && (
        <View style={styles.cartBar}>
          <View style={styles.cartInfo}>
            <Text style={styles.cartCount}>{itemCount} Artikel</Text>
            <Text style={styles.cartDate}>
              Abholung {selectedDay === 'wednesday' ? 'Mi' : 'Sa'}
            </Text>
          </View>
          <Button
            title="Zum Warenkorb"
            onPress={() => router.push('/cart')}
            size="sm"
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: 100,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  dayToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    padding: 4,
    marginBottom: theme.spacing.lg,
  },
  dayButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: theme.borderRadius.sm,
  },
  dayButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  dayText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textLight,
  },
  dayTextActive: {
    color: theme.colors.white,
  },
  productRow: {
    marginBottom: theme.spacing.md,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  addButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.white,
  },
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: theme.spacing.lg,
  },
  cartInfo: {},
  cartCount: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
  },
  cartDate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
  },
});
