import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { Order, PickupLocation } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Vorgemerkt',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderbar',
  locked_for_production: 'In Produktion',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

const FILTER_OPTIONS = ['all', 'scheduled', 'locked_for_production', 'fulfilled', 'cancelled'];

export default function AdminOrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [filterLocation, setFilterLocation] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from('orders')
      .select('*, pickup_location:pickup_locations(*)')
      .order('fulfillment_date', { ascending: true })
      .limit(100);

    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (filterLocation) query = query.eq('pickup_location_id', filterLocation);

    const { data } = await query;
    setOrders(data as any ?? []);
  }, [filterStatus, filterLocation]);

  useEffect(() => {
    fetchOrders();
    supabase.from('pickup_locations').select('*').order('sort_order').then(({ data }) => setLocations(data ?? []));
  }, [fetchOrders]);

  const handleFulfill = async (orderId: string) => {
    const { error } = await supabase.from('orders').update({ status: 'fulfilled' }).eq('id', orderId);
    if (error) Alert.alert('Fehler', error.message);
    else fetchOrders();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView horizontal style={styles.filterRow} showsHorizontalScrollIndicator={false}>
        {FILTER_OPTIONS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filterStatus === f && styles.filterChipActive]}
            onPress={() => setFilterStatus(f)}
          >
            <Text style={[styles.filterText, filterStatus === f && styles.filterTextActive]}>
              {f === 'all' ? 'Alle' : STATUS_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchOrders(); setRefreshing(false); }} />}
      >
        {orders.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <Text style={styles.orderName}>{order.customer_name || order.customer_email || 'Gast'}</Text>
              <View style={[styles.statusBadge, { backgroundColor: order.status === 'fulfilled' ? '#D1FAE5' : '#FEF3C7' }]}>
                <Text style={styles.statusText}>{STATUS_LABELS[order.status]}</Text>
              </View>
            </View>
            <Text style={styles.orderDate}>
              {new Date(order.fulfillment_date).toLocaleDateString('de-DE')}
            </Text>
            <Text style={styles.orderTotal}>{(order.total_cents / 100).toFixed(2)}€</Text>
            {(order as any).pickup_location && (
              <Text style={styles.orderLocation}>{(order as any).pickup_location.name}</Text>
            )}
            {order.status !== 'fulfilled' && order.status !== 'cancelled' && (
              <Button title="Als abgeholt markieren" onPress={() => handleFulfill(order.id)} variant="accent" size="sm" style={styles.fulfillButton} />
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  filterRow: { padding: theme.spacing.md, paddingBottom: 0 },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.cream,
    marginRight: theme.spacing.sm,
  },
  filterChipActive: { backgroundColor: theme.colors.primary },
  filterText: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, fontWeight: '500' },
  filterTextActive: { color: theme.colors.white },
  scroll: { padding: theme.spacing.md, paddingBottom: theme.spacing.xxl },
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
  orderName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  statusBadge: { borderRadius: theme.borderRadius.sm, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.text },
  orderDate: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  orderTotal: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.primary, marginTop: theme.spacing.xs },
  orderLocation: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  fulfillButton: { marginTop: theme.spacing.md },
});
