import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, type ViewStyle } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { formatPrice } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Order, OrderWithItems, PickupLocation } from '@/lib/types';
import { isReadyForPickup, orderStatusLabel } from '@/lib/orderStatus';


export default function OrdersScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!user) { setOrders([]); return; }
    const { data } = await supabase
      .from('orders')
      .select('*, items:order_items(*, product:products(*)), pickup_location:pickup_locations(*)')
      .eq('customer_id', user.id)
      .order('fulfillment_date', { ascending: false })
      .limit(50);
    setOrders((data ?? []) as unknown as OrderWithItems[]);
  }, [user]);

  useFocusEffect(useCallback(() => { fetchOrders(); }, [fetchOrders]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Anmelden erforderlich</Text>
          <TouchableOpacity style={styles.loginLink} onPress={() => router.push('/login')}>
            <Text style={styles.loginText}>Zum Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bestellungen</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {orders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Noch keine Bestellungen</Text>
            <Text style={styles.emptyText}>Deine Bestellungen und Abo-Lieferungen erscheinen hier.</Text>
          </View>
        ) : (
          orders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => router.push(`/order/${order.id}`)}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderDate}>
                  {new Date(order.fulfillment_date).toLocaleDateString('de-DE', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    isReadyForPickup(order)
                      ? styles.status_ready
                      : (styles[`status_${order.status}` as keyof typeof styles] as ViewStyle) ||
                        styles.status_scheduled,
                  ]}
                >
                  <Text style={[styles.statusText, isReadyForPickup(order) ? styles.statusTextReady : null]}>
                    {orderStatusLabel(order)}
                  </Text>
                </View>
              </View>
              <Text style={styles.orderLocation}>{order.pickup_location?.name}</Text>
              <Text style={styles.orderTotal}>{formatPrice(order.total_cents)}</Text>
              {order.items && (
                <Text style={styles.orderItems} numberOfLines={1}>
                  {order.items.map((i) => `${i.quantity}× ${i.product?.name}`).join(', ')}
                </Text>
              )}
            </TouchableOpacity>
          ))
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
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
  },
  filterRow: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.cream,
    marginRight: theme.spacing.sm,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    fontWeight: '500',
  },
  filterTextActive: {
    color: theme.colors.white,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingTop: 0,
    paddingBottom: theme.spacing.xxl,
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
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  orderDate: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  statusBadge: {
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  // Solid brand red — the only badge meant to be noticed across the list.
  status_ready: { backgroundColor: theme.colors.primary },
  status_scheduled: { backgroundColor: '#E5E7EB' },
  status_processing: { backgroundColor: '#DBEAFE' },
  status_grace_period_open: { backgroundColor: '#FEF3C7' },
  status_locked_for_production: { backgroundColor: '#FED7AA' },
  status_fulfilled: { backgroundColor: '#D1FAE5' },
  status_refunded: { backgroundColor: '#FCE7F3' },
  status_cancelled: { backgroundColor: '#FEE2E2' },
  statusTextReady: { color: theme.colors.white },
  statusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.text,
  },
  orderLocation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },
  orderTotal: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  orderItems: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
  },
  emptyText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textLight,
  },
  loginLink: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
  },
  loginText: {
    color: theme.colors.white,
    fontWeight: '600',
  },
});
