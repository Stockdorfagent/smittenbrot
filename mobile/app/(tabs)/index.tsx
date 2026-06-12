import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/Button';
import { ClosureBanner } from '@/components/ClosureBanner';
import { ProductCard } from '@/components/ProductCard';
import type { Product, Subscription, Order, WeekCycle } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { addItem } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [activeSubscription, setActiveSubscription] = useState<Subscription | null>(null);
  const [upcomingOrder, setUpcomingOrder] = useState<Order | null>(null);
  const [nextPickupDate, setNextPickupDate] = useState<string>('');
  const [weekCycle, setWeekCycle] = useState<WeekCycle | null>(null);

  const getNextPickupInfo = useCallback(() => {
    const now = new Date();
    const day = now.getDay();
    let wednesday = new Date(now);
    let saturday = new Date(now);
    wednesday.setDate(now.getDate() + ((3 - day + 7) % 7));
    saturday.setDate(now.getDate() + ((6 - day + 7) % 7));

    const cutoffMonday = new Date(wednesday);
    cutoffMonday.setDate(wednesday.getDate() - 2);
    cutoffMonday.setHours(22, 0, 0, 0);
    const cutoffThursday = new Date(saturday);
    cutoffThursday.setDate(saturday.getDate() - 2);
    cutoffThursday.setHours(22, 0, 0, 0);

    if (now < cutoffMonday && wednesday > now) {
      setNextPickupDate(wednesday.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }));
    } else {
      setNextPickupDate(saturday.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }));
    }
  }, []);

  const fetchData = useCallback(async () => {
    const { data: cycle } = await supabase.from('week_cycle').select('*').maybeSingle();
    setWeekCycle(cycle);

    const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(4);
    setFeaturedProducts(products ?? []);

    if (user) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('customer_id', user.id)
        .in('status', ['active', 'paused'])
        .maybeSingle();
      setActiveSubscription(sub);

      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', user.id)
        .in('status', ['scheduled', 'processing', 'grace_period_open', 'locked_for_production'])
        .order('fulfillment_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      setUpcomingOrder(order);
    }

    getNextPickupInfo();
  }, [user, getNextPickupInfo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ClosureBanner />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {user ? `Hallo, ${user.name.split(' ')[0]}!` : 'Willkommen bei Smittenbrot'}
          </Text>
          <Text style={styles.tagline}>Handgemachtes Sauerteigbrot aus München</Text>
        </View>

        <View style={styles.pickupCard}>
          <Text style={styles.pickupLabel}>Nächste Abholung</Text>
          <Text style={styles.pickupDate}>{nextPickupDate}</Text>
          <Text style={styles.pickupHint}>Bestelle bis Montag/Donnerstag 22:00 Uhr</Text>
        </View>

        {!user && (
          <View style={styles.ctaCard}>
            <Text style={styles.ctaTitle}>Bestelle direkt oder abonniere!</Text>
            <Text style={styles.ctaText}>Erstelle ein Konto für Abos und schnelleren Checkout.</Text>
            <View style={styles.ctaRow}>
              <Button title="Anmelden" onPress={() => router.push('/login')} size="sm" style={styles.ctaButton} />
              <Button title="Gastbestellung" onPress={() => router.push('/(tabs)/shop')} variant="accent" size="sm" style={styles.ctaButton} />
            </View>
          </View>
        )}

        {activeSubscription && (
          <TouchableOpacity style={styles.subCard} onPress={() => router.push('/(tabs)/subscriptions')}>
            <Text style={styles.subTitle}>
              {activeSubscription.status === 'paused' ? 'Abonnement pausiert' : 'Aktives Abonnement'}
            </Text>
            <Text style={styles.subAction}>
              {activeSubscription.status === 'paused' ? 'Zum Abonnement →' : 'Verwalten →'}
            </Text>
          </TouchableOpacity>
        )}

        {upcomingOrder && (
          <TouchableOpacity style={styles.orderCard} onPress={() => router.push(`/order/${upcomingOrder.id}`)}>
            <Text style={styles.orderTitle}>Nächste Bestellung</Text>
            <Text style={styles.orderDate}>
              {new Date(upcomingOrder.fulfillment_date).toLocaleDateString('de-DE', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </Text>
            <Text style={styles.orderAction}>Details anzeigen →</Text>
          </TouchableOpacity>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Diese Woche im Sortiment</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/shop')}>
            <Text style={styles.sectionLink}>Alle anzeigen</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.productGrid}>
          {featuredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              available
              onAddToCart={() => {
                addItem({
                  product_id: product.id,
                  product_name: product.name,
                  quantity: 1,
                  unit_price_cents: product.price_cents,
                });
                router.push('/(tabs)/shop');
              }}
            />
          ))}
        </View>

        {user && (
          <View style={styles.quickActions}>
            <Button
              title="Schnellbestellung"
              onPress={() => router.push('/(tabs)/shop')}
              variant="primary"
              size="lg"
            />
          </View>
        )}
      </ScrollView>
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
    paddingBottom: theme.spacing.xxl,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  greeting: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
  },
  tagline: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  pickupCard: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  pickupLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pickupDate: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.white,
    marginTop: theme.spacing.xs,
  },
  pickupHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.cream,
    marginTop: theme.spacing.sm,
    opacity: 0.8,
  },
  ctaCard: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  ctaTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
  },
  ctaText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  ctaButton: {
    flex: 1,
  },
  subCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accent,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  subTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  subAction: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
    marginTop: theme.spacing.xs,
  },
  orderCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  orderTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },
  orderDate: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  orderAction: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
    marginTop: theme.spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
  },
  sectionLink: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
  },
  productGrid: {
    gap: theme.spacing.md,
  },
  quickActions: {
    marginTop: theme.spacing.lg,
  },
});
