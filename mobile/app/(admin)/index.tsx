import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { ProductionSheet } from '@/lib/types';

const QUICK_LINKS = [
  { title: 'Bestellungen', route: '/(admin)/orders', icon: '📋' },
  { title: 'Produkte', route: '/(admin)/products', icon: '🥖' },
  { title: 'Abholorte', route: '/(admin)/pickup-locations', icon: '📍' },
  { title: 'Schließungen', route: '/(admin)/closures', icon: '🔒' },
  { title: 'Benachrichtigungen', route: '/(admin)/notifications', icon: '🔔' },
  { title: 'Einstellungen', route: '/(admin)/settings', icon: '⚙️' },
];

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [ordersCount, setOrdersCount] = useState(0);
  const [activeSubs, setActiveSubs] = useState(0);
  const [productionSheet, setProductionSheet] = useState<ProductionSheet | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('fulfillment_date', today)
      .in('status', ['scheduled', 'processing', 'locked_for_production']);
    setOrdersCount(count ?? 0);

    const { count: subCount } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    setActiveSubs(subCount ?? 0);
  };

  useEffect(() => { fetchStats(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{ordersCount}</Text>
            <Text style={styles.statLabel}>Offene Bestellungen</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{activeSubs}</Text>
            <Text style={styles.statLabel}>Aktive Abos</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Produktionsliste</Text>
        {productionSheet ? (
          productionSheet.items.map((item) => (
            <View key={item.product_id} style={styles.prodRow}>
              <Text style={styles.prodName}>{item.product_name}</Text>
              <Text style={styles.prodQty}>
                {item.total_quantity} / {item.capacity}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.hint}>Nächste Produktionsliste wird automatisch generiert.</Text>
        )}

        <Text style={styles.sectionTitle}>Quick Links</Text>
        <View style={styles.grid}>
          {QUICK_LINKS.map((link) => (
            <TouchableOpacity
              key={link.route}
              style={styles.gridItem}
              onPress={() => router.push(link.route)}
            >
              <Text style={styles.gridIcon}>{link.icon}</Text>
              <Text style={styles.gridLabel}>{link.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statNumber: {
    fontSize: theme.fontSize.hero,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  prodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.white,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  prodName: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  prodQty: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.secondary,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    fontStyle: 'italic',
    marginBottom: theme.spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  gridItem: {
    width: '30%',
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  gridIcon: {
    fontSize: 28,
    marginBottom: theme.spacing.sm,
  },
  gridLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500',
    color: theme.colors.text,
    textAlign: 'center',
  },
});
