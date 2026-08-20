import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getNextPickup } from '@/lib/pickup';

interface OrderRow {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  status: string;
  payment_status: string;
  pickup_location: { name: string } | null;
  items: { quantity: number; product: { name: string } | null }[];
}

// Statuses that still need baking (exclude cancelled / refunded).
const ACTIVE = ['scheduled', 'processing', 'grace_period_open', 'locked_for_production'];

// While test-invoice-mode is on (migration 008) paid orders are numbered
// TEST-#00001… . Those come from app testers, not customers, and must not end
// up in the bake list — baking for them would waste real flour. They are hidden
// but counted, never silently dropped.
const isTestOrder = (o: OrderRow) => (o.order_number ?? '').startsWith('TEST-');

export default function AdminBakeday() {
  const { user } = useAuth();
  const pickup = getNextPickup();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select(
        'id, order_number, customer_name, status, payment_status, pickup_location:pickup_locations(name), items:order_items(quantity, product:products(name))',
      )
      .eq('fulfillment_date', pickup.date)
      .in('status', ACTIVE)
      .order('created_at', { ascending: true });
    setOrders((data as OrderRow[] | null) ?? []);
    setLoading(false);
  }, [pickup.date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Non-admins never reach this via UI, but guard the route directly too.
  if (!user?.is_admin) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Backtag' }} />
        <View style={styles.center}>
          <Text style={styles.muted}>Nur für Administratoren.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const realOrders = orders.filter((o) => !isTestOrder(o));
  const hiddenTestCount = orders.length - realOrders.length;

  // Aggregate quantity per product across all orders → the bake list.
  const totals: Record<string, number> = {};
  for (const o of realOrders) {
    for (const it of o.items ?? []) {
      const name = it.product?.name ?? 'Produkt';
      totals[name] = (totals[name] ?? 0) + it.quantity;
    }
  }
  const bakeList = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const totalItems = bakeList.reduce((s, [, q]) => s + q, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ title: 'Backtag-Übersicht' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.h1}>Nächster Backtag</Text>
        <Text style={styles.date}>{pickup.label}</Text>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.xl }} />
        ) : realOrders.length === 0 ? (
          <>
            <Text style={[styles.muted, { marginTop: theme.spacing.lg }]}>
              Noch keine Bestellungen für diesen Backtag.
            </Text>
            {hiddenTestCount > 0 && (
              <Text style={styles.testNote}>
                {hiddenTestCount} Testbestellung{hiddenTestCount === 1 ? '' : 'en'} ausgeblendet.
              </Text>
            )}
          </>
        ) : (
          <>
            {/* Backliste — how much to bake in total */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Backliste</Text>
              {bakeList.map(([name, qty]) => (
                <View key={name} style={styles.bakeRow}>
                  <Text style={styles.bakeName}>{name}</Text>
                  <Text style={styles.bakeQty}>{qty}×</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.bakeRow}>
                <Text style={styles.bakeTotalLabel}>{realOrders.length} Bestellungen</Text>
                <Text style={styles.bakeTotalLabel}>{totalItems} Artikel</Text>
              </View>
              {hiddenTestCount > 0 && (
                <Text style={styles.testNote}>
                  {hiddenTestCount} Testbestellung{hiddenTestCount === 1 ? '' : 'en'} ausgeblendet
                  (Nummer beginnt mit TEST-).
                </Text>
              )}
            </View>

            {/* Per-order list */}
            <Text style={styles.section}>Bestellungen</Text>
            {realOrders.map((o) => (
              <View key={o.id} style={styles.orderCard}>
                <View style={styles.orderHead}>
                  <Text style={styles.orderName}>{o.customer_name ?? 'Kunde'}</Text>
                  <Text style={styles.orderLoc}>{o.pickup_location?.name ?? ''}</Text>
                </View>
                {(o.items ?? []).map((it, i) => (
                  <Text key={i} style={styles.orderItem}>
                    {it.quantity}× {it.product?.name ?? 'Produkt'}
                  </Text>
                ))}
                {o.payment_status !== 'paid' && (
                  <Text style={styles.pending}>Vorgemerkt (noch nicht bezahlt)</Text>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  h1: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  date: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
  muted: { fontSize: theme.fontSize.md, color: theme.colors.textLight },
  testNote: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, marginTop: theme.spacing.sm },
  card: {
    backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg, marginTop: theme.spacing.lg,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.md },
  bakeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.sm },
  bakeName: { fontSize: theme.fontSize.md, color: theme.colors.text },
  bakeQty: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.sm },
  bakeTotalLabel: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  section: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  orderCard: {
    backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md, marginBottom: theme.spacing.sm,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  orderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.xs },
  orderName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  orderLoc: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  orderItem: { fontSize: theme.fontSize.sm, color: theme.colors.text, marginTop: 2 },
  pending: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, marginTop: theme.spacing.xs, fontStyle: 'italic' },
});
