import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Vorgemerkt',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderbar',
  locked_for_production: 'In Produktion',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Ausstehend',
  paid: 'Bezahlt',
  failed: 'Fehlgeschlagen',
  refunded: 'Rückerstattet',
};

interface OrderItem {
  quantity: number;
  unit_price_cents: number;
  product: { name: string } | null;
}
interface OrderRow {
  id: string;
  order_number: string | null;
  order_type: string;
  status: string;
  payment_status: string;
  fulfillment_date: string;
  total_cents: number;
  created_at: string;
  customer_name: string | null;
  items: OrderItem[];
  pickup_location: { name: string; address: string } | null;
}

const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, order_type, status, payment_status, fulfillment_date, total_cents, created_at, customer_name, items:order_items(quantity, unit_price_cents, product:products(name)), pickup_location:pickup_locations(name, address)')
      .eq('id', id)
      .single();
    setOrder((data as unknown as OrderRow) ?? null);
    setLoading(false);
  }

  function confirmCancel() {
    Alert.alert(
      'Bestellung stornieren?',
      'Deine Bestellung wird storniert und der Betrag vollständig zurückerstattet.',
      [
        { text: 'Zurück', style: 'cancel' },
        { text: 'Stornieren', style: 'destructive', onPress: doCancel },
      ],
    );
  }

  async function doCancel() {
    setCancelling(true);
    try {
      const { error } = await supabase.functions.invoke('cancel-order', { body: { order_id: id } });
      if (error) {
        let message = 'Stornierung fehlgeschlagen.';
        if (error instanceof FunctionsHttpError) {
          try { const b = await error.context.json(); message = b?.error ?? message; } catch { /* keep default */ }
        }
        Alert.alert('Nicht möglich', message);
        return;
      }
      Alert.alert('Storniert', 'Deine Bestellung wurde storniert und der Betrag zurückerstattet.');
      await load();
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <SafeAreaView style={styles.container}><View style={styles.center}><Text style={styles.muted}>Lädt…</Text></View></SafeAreaView>;
  }
  if (!order) {
    return <SafeAreaView style={styles.container}><View style={styles.center}><Text style={styles.muted}>Bestellung nicht gefunden</Text></View></SafeAreaView>;
  }

  const grossCents = order.total_cents;
  const netCents = Math.round(grossCents / 1.07);
  const vatCents = grossCents - netCents;

  const canCancel =
    order.order_type === 'one_time' &&
    order.payment_status === 'paid' &&
    !['cancelled', 'refunded', 'fulfilled'].includes(order.status);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Bestellbestätigung</Text>
          {order.order_number
            ? <Text style={styles.orderNumber}>Bestellnummer {order.order_number}</Text>
            : <Text style={styles.orderNumber}>Bestellung vom {new Date(order.created_at).toLocaleDateString('de-DE')}</Text>}
        </View>

        <View style={styles.section}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Status</Text>
            <Text style={styles.detailValue}>{STATUS_LABELS[order.status] ?? order.status}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Abholung</Text>
            <Text style={styles.detailValue}>
              {new Date(order.fulfillment_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          {order.pickup_location && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Abholort</Text>
              <Text style={styles.detailValue}>{order.pickup_location.name}</Text>
            </View>
          )}
          <View style={[styles.detailRow, styles.lastRow]}>
            <Text style={styles.detailLabel}>Zahlung</Text>
            <Text style={styles.detailValue}>{PAYMENT_LABELS[order.payment_status] ?? order.payment_status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Artikel</Text>
          {order.items?.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.quantity}× {item.product?.name ?? 'Produkt'}
              </Text>
              <Text style={styles.itemPrice}>{fmt(item.unit_price_cents * item.quantity)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.smallLabel}>Nettobetrag</Text>
            <Text style={styles.smallValue}>{fmt(netCents)}</Text>
          </View>
          <View style={styles.itemRow}>
            <Text style={styles.smallLabel}>zzgl. 7 % MwSt.</Text>
            <Text style={styles.smallValue}>{fmt(vatCents)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>Gesamt (brutto)</Text>
            <Text style={styles.totalValue}>{fmt(grossCents)}</Text>
          </View>
        </View>

        <Text style={styles.note}>
          {order.payment_status === 'paid'
            ? 'Deine Rechnung haben wir dir per E-Mail geschickt.'
            : 'Die Zahlung erfolgt am Bestelltag. Deine Rechnung erhältst du danach per E-Mail.'}
        </Text>

        {canCancel && (
          <TouchableOpacity style={styles.cancelButton} onPress={confirmCancel} disabled={cancelling} activeOpacity={0.8}>
            <Text style={styles.cancelButtonText}>{cancelling ? 'Wird storniert…' : 'Bestellung stornieren'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: theme.fontSize.md, color: theme.colors.textLight },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  header: { marginBottom: theme.spacing.lg },
  title: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.colors.text },
  orderNumber: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  section: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  detailLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  detailValue: { fontSize: theme.fontSize.sm, color: theme.colors.text, fontWeight: '500' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  itemName: { fontSize: theme.fontSize.md, color: theme.colors.text, flex: 1, marginRight: theme.spacing.sm },
  itemPrice: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '500' },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.sm },
  smallLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  smallValue: { fontSize: theme.fontSize.sm, color: theme.colors.text },
  totalLabel: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  totalValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, textAlign: 'center', marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg, lineHeight: 20 },
  cancelButton: {
    borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md, alignItems: 'center',
  },
  cancelButtonText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.primary },
});
