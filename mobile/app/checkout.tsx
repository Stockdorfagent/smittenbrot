import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';

export default function CheckoutScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, pickup_location_id, pickup_day, totalCents, clearCart } = useCart();
  const [loading, setLoading] = useState(false);

  const handlePlaceOrder = async () => {
    if (!pickup_location_id || items.length === 0) {
      Alert.alert('Fehler', 'Warenkorb ist leer oder Abholort fehlt.');
      return;
    }

    setLoading(true);
    try {
      const fulfillmentDate = getNextPickupDate(pickup_day!);
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substring(2)}`;

      const orderData = {
        customer_id: user?.id ?? null,
        customer_email: user?.email ?? null,
        customer_name: user?.name ?? null,
        order_type: 'one_time',
        fulfillment_date: fulfillmentDate,
        pickup_location_id,
        status: 'scheduled',
        payment_status: 'pending',
        total_cents: totalCents,
        idempotency_key: idempotencyKey,
      };

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();

      if (orderError || !order) {
        Alert.alert('Fehler', orderError?.message ?? 'Bestellung fehlgeschlagen');
        return;
      }

      const orderItems = items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) {
        Alert.alert('Fehler', itemsError.message);
        return;
      }

      clearCart();
      router.replace(`/order/${order.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Bestellübersicht</Text>
          {items.map((item) => (
            <View key={item.product_id} style={styles.summaryRow}>
              <Text style={styles.summaryName}>
                {item.quantity}× {item.product_name}
              </Text>
              <Text style={styles.summaryPrice}>
                {((item.unit_price_cents * item.quantity) / 100).toFixed(2)}€
              </Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gesamtsumme</Text>
            <Text style={styles.totalValue}>{(totalCents / 100).toFixed(2)}€</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Deine Bestellung wird nach Zahlungseingang bestätigt.
          </Text>
          <Text style={styles.infoText}>
            Bei Zahlungsproblemen werden wir dich per E-Mail kontaktieren.
          </Text>
        </View>

        <Button
          title={`${totalCents / 100}€ bezahlen`}
          onPress={handlePlaceOrder}
          loading={loading}
          size="lg"
          style={styles.payButton}
        />

        <Text style={styles.hint}>
          Stripe-Zahlung wird beim nächsten Release integriert. Vorab wird die Bestellung mit "pending" erfasst.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function getNextPickupDate(pickupDay: string): string {
  const now = new Date();
  const targetDay = pickupDay === 'wednesday' ? 3 : 6;
  const next = new Date(now);
  next.setDate(now.getDate() + ((targetDay - now.getDay() + 7) % 7));
  if (next <= now) next.setDate(next.getDate() + 7);
  return next.toISOString().split('T')[0];
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
  summaryCard: {
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
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  summaryName: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  summaryPrice: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing.sm,
  },
  totalLabel: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
  },
  totalValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  infoCard: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  infoText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.xs,
  },
  payButton: {
    marginBottom: theme.spacing.md,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
