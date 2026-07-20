import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { getNextPickup } from '@/lib/pickup';
import { Button } from '@/components/Button';
import { ClosureBanner } from '@/components/ClosureBanner';
import { ProductCard } from '@/components/ProductCard';
import { ProductDetailModal } from '@/components/ProductDetailModal';
import type { Product, Subscription, Order, WeekCycle } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { addItem, itemCount, totalCents } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<Subscription | null>(null);
  const [upcomingOrder, setUpcomingOrder] = useState<Order | null>(null);

  const pickup = useMemo(() => getNextPickup(), []);

  const fetchData = useCallback(async () => {
    const { data: cycle } = await supabase.from('week_cycle').select('*').maybeSingle<WeekCycle>();

    const { data: allProducts } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    const filtered = (allProducts ?? []).filter((p) => {
      if (p.cycle === 'hidden') return false;
      if (pickup.day === 'wednesday' && !p.available_wed) return false;
      if (pickup.day === 'saturday' && !p.available_sat) return false;
      if (p.cycle === 'week_a' && cycle?.current_week !== 'A') return false;
      if (p.cycle === 'week_b' && cycle?.current_week !== 'B') return false;
      return true;
    });
    setProducts(filtered);

    // Real availability per product for the upcoming pickup date.
    const entries = await Promise.all(
      filtered.map(async (p) => {
        try {
          const { data } = await supabase.functions.invoke('capacity-manager/check-capacity', {
            body: { product_id: p.id, fulfillment_date: pickup.date },
          });
          const available = typeof data?.available_count === 'number' ? data.available_count : 1;
          return [p.id, available <= 0] as const;
        } catch {
          return [p.id, false] as const;
        }
      }),
    );
    setSoldOut(Object.fromEntries(entries));

    if (user) {
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('customer_id', user.id)
        .in('status', ['active', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1);
      setActiveSubscription((subs?.[0] as Subscription) ?? null);

      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', user.id)
        .eq('payment_status', 'paid')
        .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production'])
        .order('fulfillment_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      setUpcomingOrder(order);
    }
  }, [user, pickup.day, pickup.date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleAddToCart = (product: Product) => {
    if (soldOut[product.id]) return;
    const qty = quantities[product.id] || 1;
    const add = () => {
      addItem({
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit_price_cents: product.price_cents,
      });
      setQuantities((prev) => ({ ...prev, [product.id]: 0 }));
    };
    if (qty > 10) {
      Alert.alert('Menge bestätigen', `Du hast ${qty}× ${product.name} ausgewählt. Ist das korrekt?`, [
        { text: 'Menge ändern', style: 'cancel' },
        { text: 'Ja', onPress: add },
      ]);
    } else {
      add();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ClosureBanner />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.brandHeader}>
          <Image source={require('../../assets/logo-mark.png')} style={styles.logo} />
          <Text style={styles.brand}>Smittenbrot</Text>
          <Text style={styles.tagline}>Sauerteig aus Stockdorf</Text>
        </View>

        <View style={styles.pickupInfo}>
          <Text style={styles.pickupInfoText}>Jetzt bestellen für {pickup.label}</Text>
          <Text style={styles.pickupInfoDate}>{pickup.cutoffLabel}</Text>
        </View>

        {activeSubscription && (
          <TouchableOpacity style={styles.infoCard} onPress={() => router.push('/(tabs)/subscriptions')}>
            <View style={styles.infoDot} />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>
                {activeSubscription.status === 'paused' ? 'Abonnement pausiert' : 'Aktives Abonnement'}
              </Text>
              <Text style={styles.infoAction}>Verwalten ›</Text>
            </View>
          </TouchableOpacity>
        )}

        {upcomingOrder && (
          <TouchableOpacity style={styles.infoCard} onPress={() => router.push(`/order/${upcomingOrder.id}`)}>
            <View style={[styles.infoDot, { backgroundColor: theme.colors.success }]} />
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>Nächste Abholung</Text>
              <Text style={styles.infoSub}>
                {new Date(upcomingOrder.fulfillment_date + 'T12:00:00').toLocaleDateString('de-DE', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Unser Sortiment</Text>

        {products.map((product) => {
          const qty = quantities[product.id] || 0;
          const isSoldOut = soldOut[product.id] === true;
          return (
            <View key={product.id} style={styles.productItem}>
              <ProductCard
                product={product}
                available={!isSoldOut}
                quantity={qty}
                onPress={() => setDetailProduct(product)}
                onIncrease={() => setQuantities((prev) => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }))}
                onDecrease={() => setQuantities((prev) => ({ ...prev, [product.id]: Math.max(0, (prev[product.id] || 0) - 1) }))}
                onAdd={() => handleAddToCart(product)}
              />
            </View>
          );
        })}
      </ScrollView>

      {itemCount > 0 && (
        <View style={styles.cartBar}>
          <Text style={styles.cartBarText}>
            {itemCount} {itemCount === 1 ? 'Artikel' : 'Artikel'} · {(totalCents / 100).toFixed(2).replace('.', ',')} €
          </Text>
          <Button title="Zum Warenkorb" onPress={() => router.push('/(tabs)/cart')} size="sm" />
        </View>
      )}

      <ProductDetailModal
        product={detailProduct}
        visible={!!detailProduct}
        onClose={() => setDetailProduct(null)}
        onAdd={handleAddToCart}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.lg, paddingBottom: 96 },
  brandHeader: { alignItems: 'center', marginBottom: theme.spacing.lg },
  logo: { width: 72, height: 72, resizeMode: 'contain' },
  brand: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.colors.text, marginTop: theme.spacing.xs },
  tagline: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  pickupInfo: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  pickupInfoText: { fontSize: theme.fontSize.sm, color: theme.colors.text, fontWeight: '600' },
  pickupInfoDate: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  infoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary, marginRight: theme.spacing.md },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  infoSub: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  infoAction: { fontSize: theme.fontSize.sm, color: theme.colors.primary, marginTop: 2 },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  productItem: { marginBottom: theme.spacing.lg },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  addButton: { flex: 1 },
  cartBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  cartBarText: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text },
});
