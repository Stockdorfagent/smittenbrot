import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useStripe } from '@stripe/stripe-react-native';
import { theme } from '@/lib/theme';
import { formatPrice as fmt } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { isReadyForPickup, orderStatusLabel } from '@/lib/orderStatus';
import { loadPickedUp, markPickedUp, unmarkPickedUp } from '@/lib/pickedUp';
import { collectPaymentMethod } from '@/lib/stripeSetup';

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
  customer_id: string | null;
  customer_email: string | null;
  pickup_ready_at: string | null;
  fulfillment_date: string;
  total_cents: number;
  created_at: string;
  customer_name: string | null;
  items: OrderItem[];
  pickup_location: { name: string; address: string; pickup_instructions: string | null } | null;
}


export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [collected, setCollected] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    setLoading(true);
    if (id) setCollected((await loadPickedUp()).has(id));
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, order_type, status, payment_status, customer_id, customer_email, pickup_ready_at, fulfillment_date, total_cents, created_at, customer_name, items:order_items(quantity, unit_price_cents, product:products(name)), pickup_location:pickup_locations(name, address, pickup_instructions)')
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

  /**
   * "Mach daraus ein Abo" (tester request): same products, same Abholort,
   * same Wochentag — created server-side by the engine, which also checks
   * that a card is on file and starts the Abo at the NEXT delivery so this
   * week's bread is not baked twice. needs_payment_method falls back to the
   * shared PaymentSheet flow, then retries once.
   */
  async function doConvert(retryAfterCard = true): Promise<void> {
    setConverting(true);
    try {
      const { error } = await supabase.functions.invoke(
        'subscription-engine/convert-order-to-subscription',
        { body: { order_id: id } },
      );
      if (!error) {
        Alert.alert(
          'Abo eingerichtet',
          'Ab jetzt kommt diese Bestellung jede Woche — los geht es mit der nächsten Lieferung. Verwalten kannst du das Abo unter „Abos“.',
          [{ text: 'Zu meinen Abos', onPress: () => router.push('/(tabs)/subscriptions') }, { text: 'OK' }],
        );
        return;
      }
      let message = 'Das hat leider nicht geklappt. Bitte versuche es erneut.';
      let needsCard = false;
      if (error instanceof FunctionsHttpError) {
        try {
          const b = await error.context.json();
          message = b?.error ?? message;
          needsCard = !!b?.needs_payment_method;
        } catch { /* keep default */ }
      }
      if (needsCard && retryAfterCard) {
        const card = await collectPaymentMethod({ initPaymentSheet, presentPaymentSheet });
        if (card.ok) return await doConvert(false);
        if (!card.cancelled) Alert.alert('Fehler', card.error ?? message);
        return;
      }
      Alert.alert('Nicht möglich', message);
    } finally {
      setConverting(false);
    }
  }

  function confirmConvert() {
    if (!order) return;
    const itemsText = (order.items ?? [])
      .map((i) => `${i.quantity}× ${i.product?.name ?? 'Produkt'}`)
      .join('\n');
    const dayName = new Date(order.fulfillment_date + 'T12:00:00').getDay() === 6 ? 'Samstag' : 'Mittwoch';
    Alert.alert(
      'Daraus ein Abo machen?',
      `${itemsText}\n\nAbholort: ${order.pickup_location?.name ?? '—'}\nAbholtag: jeden ${dayName}\n\nDiese Bestellung bleibt wie sie ist — das Abo liefert ab dem nächsten ${dayName} und wird jeweils am Bestelltag abgebucht. Jederzeit pausierbar und kündbar.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Abo einrichten', onPress: () => doConvert() },
      ],
    );
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

  // Only the person who placed it may cancel — the server enforces this and
  // returns 403 otherwise, so showing the button to an admin looking at someone
  // else's order (which is now what a sale alert opens) would only produce an
  // error message.
  const isOwnOrder =
    !!user &&
    (order.customer_id === user.id ||
      (order.customer_email ?? '').toLowerCase() === (user.email ?? '').toLowerCase());

  const canCancel =
    isOwnOrder &&
    order.order_type === 'one_time' &&
    order.payment_status === 'paid' &&
    !['cancelled', 'refunded', 'fulfilled'].includes(order.status);

  // Converting stays possible after collection ("das war lecker — ab jetzt
  // jede Woche"); only cancelled/refunded orders are out.
  const canConvert =
    isOwnOrder &&
    order.order_type === 'one_time' &&
    order.payment_status === 'paid' &&
    !['cancelled', 'refunded'].includes(order.status);

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
            <Text
              style={[
                styles.detailValue,
                isReadyForPickup(order, collected) ? styles.detailValueReady : null,
              ]}
            >
              {orderStatusLabel(order, collected)}
            </Text>
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
          {order.pickup_location?.pickup_instructions ? (
            <View style={styles.hintRow}>
              <Text style={styles.hintText}>{order.pickup_location.pickup_instructions}</Text>
            </View>
          ) : null}
          <View style={[styles.detailRow, styles.lastRow]}>
            <Text style={styles.detailLabel}>Zahlung</Text>
            <Text style={styles.detailValue}>{PAYMENT_LABELS[order.payment_status] ?? order.payment_status}</Text>
          </View>
          {/* Cosmetic, device-local: flips the label to "Abgeholt" right away
              instead of at midnight. Never sent anywhere (see lib/pickedUp.ts). */}
          {isReadyForPickup(order, collected) && (
            <TouchableOpacity
              style={styles.collectedButton}
              onPress={async () => { await markPickedUp(order.id); setCollected(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.collectedButtonText}>Abgeholt? Als abgeholt markieren</Text>
            </TouchableOpacity>
          )}
          {collected && isReadyForPickup(order) && (
            <TouchableOpacity
              onPress={async () => { await unmarkPickedUp(order.id); setCollected(false); }}
              hitSlop={8}
            >
              <Text style={styles.collectedUndo}>Doch nicht abgeholt? Zurücksetzen</Text>
            </TouchableOpacity>
          )}
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

        {canConvert && (
          <TouchableOpacity style={styles.convertButton} onPress={confirmConvert} disabled={converting} activeOpacity={0.8}>
            <Text style={styles.convertButtonText}>
              {converting ? 'Wird eingerichtet…' : 'Daraus ein Abo machen'}
            </Text>
          </TouchableOpacity>
        )}

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
  hintRow: {
    backgroundColor: theme.colors.cream, borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md, marginTop: theme.spacing.sm,
  },
  hintText: { fontSize: theme.fontSize.sm, color: theme.colors.text, lineHeight: 19 },
  detailLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  detailValue: { fontSize: theme.fontSize.sm, color: theme.colors.text, fontWeight: '500' },
  detailValueReady: { color: theme.colors.primary, fontWeight: '700' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  itemName: { fontSize: theme.fontSize.md, color: theme.colors.text, flex: 1, marginRight: theme.spacing.sm },
  itemPrice: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '500' },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.sm },
  smallLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  smallValue: { fontSize: theme.fontSize.sm, color: theme.colors.text },
  totalLabel: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  totalValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, textAlign: 'center', marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg, lineHeight: 20 },
  convertButton: {
    backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md, alignItems: 'center', marginBottom: theme.spacing.sm,
  },
  convertButtonText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.white },
  cancelButton: {
    borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md, alignItems: 'center',
  },
  cancelButtonText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.primary },
  collectedButton: {
    marginTop: theme.spacing.md,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md, alignItems: 'center',
  },
  collectedButtonText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  collectedUndo: {
    marginTop: theme.spacing.sm, textAlign: 'center',
    fontSize: theme.fontSize.sm, color: theme.colors.textLight, textDecorationLine: 'underline',
  },
});
