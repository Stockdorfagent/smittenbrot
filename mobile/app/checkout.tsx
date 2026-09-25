import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { theme } from '@/lib/theme';
import { formatPrice as fmt } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { getNextPickupFor } from '@/lib/pickup';
import { Button } from '@/components/Button';

export default function CheckoutScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, pickup_location_id, totalCents, clearCart } = useCart();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading] = useState(false);
  // Discount code (owner 25.09.2026: the app had no field, codes worked on the
  // website only). Preview via the website's validate route (same rules the
  // server applies); the payment function re-validates and sets the amount.
  const [codeInput, setCodeInput] = useState('');
  const [discount, setDiscount] = useState<{ code: string; cents: number } | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState('');

  const applyCode = async () => {
    const code = codeInput.trim();
    if (!code || !user) return;
    setCodeBusy(true); setCodeError('');
    try {
      const loc = pickup_location_id
        ? (await supabase.from('pickup_locations').select('available_wed, available_sat').eq('id', pickup_location_id).maybeSingle()).data
        : null;
      const res = await fetch(siteUrl('/api/validate-discount'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          email: user.email,
          items: items.map((i) => ({ price_cents: i.unit_price_cents, quantity: i.quantity })),
          fulfillment_date: getNextPickupFor(loc ?? null).date,
        }),
      });
      const d = await res.json();
      if (d?.valid) { setDiscount({ code: d.discount.code, cents: d.discountCents }); setCodeInput(d.discount.code); }
      else { setDiscount(null); setCodeError(d?.error ?? 'Code ungültig.'); }
    } catch {
      setCodeError('Prüfung nicht möglich. Bitte später erneut versuchen.');
    } finally {
      setCodeBusy(false);
    }
  };
  const payCents = Math.max(0, totalCents - (discount?.cents ?? 0));

  const handlePlaceOrder = async () => {
    if (!pickup_location_id || items.length === 0) {
      Alert.alert('Fehler', 'Warenkorb ist leer oder Abholort fehlt.');
      return;
    }
    if (!user) {
      Alert.alert('Anmeldung erforderlich', 'Bitte melde dich an, um zu bestellen.');
      router.push('/login');
      return;
    }

    setLoading(true);
    try {
      // The location's weekdays decide the date (owner 24.09.2026): a
      // Wednesday-only location ordered on Thu/Fri means next Wednesday.
      const { data: loc } = await supabase
        .from('pickup_locations')
        .select('available_wed, available_sat')
        .eq('id', pickup_location_id)
        .maybeSingle();
      const fulfillmentDate = getNextPickupFor(loc ?? null).date;

      // 1. Create the PaymentIntent + pending order server-side. The server
      //    recomputes the price from the DB and checks capacity — the client
      //    total is never trusted.
      const { data, error } = await supabase.functions.invoke('create-payment-intent', {
        body: {
          items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
          fulfillment_date: fulfillmentDate,
          pickup_location_id,
          customer_name: user.name,
          discount_code: discount?.code ?? null,
        },
      });

      if (error) {
        let message = 'Zahlung konnte nicht gestartet werden.';
        if (error instanceof FunctionsHttpError) {
          try {
            const b = await error.context.json();
            message = b?.message ?? b?.error ?? message;
          } catch {
            /* keep default message */
          }
        }
        Alert.alert('Nicht möglich', message);
        return;
      }

      const { clientSecret, customerId, ephemeralKey } = data ?? {};
      if (!clientSecret) {
        Alert.alert('Fehler', 'Ungültige Antwort vom Server.');
        return;
      }

      // 2. Initialise the Stripe payment sheet.
      const initResult = await initPaymentSheet({
        merchantDisplayName: 'Smittenbrot',
        paymentIntentClientSecret: clientSecret,
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        returnURL: 'smittenbrot://stripe-redirect',
        allowsDelayedPaymentMethods: false,
        applePay: {
          merchantCountryCode: 'DE',
        },
        googlePay: {
          merchantCountryCode: 'DE',
          currencyCode: 'EUR',
          // Google Pay test environment while on Stripe test keys; auto-flips
          // to production when the publishable key becomes pk_live at launch.
          testEnv: !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live'),
        },
      });
      if (initResult.error) {
        Alert.alert('Fehler', initResult.error.message);
        return;
      }

      // 3. Present the payment sheet.
      const { error: sheetError } = await presentPaymentSheet();
      if (sheetError) {
        // A user-cancel is not worth an error alert.
        if (sheetError.code !== 'Canceled') {
          Alert.alert('Zahlung fehlgeschlagen', sheetError.message);
        }
        return;
      }

      // 4. Success — the order is created server-side by the stripe-webhook
      //    once payment is confirmed (no successful payment ⇒ no order).
      clearCart();
      // Land on the Bestellbestätigung itself (like the website's success
      // page) — that is where "Aus dieser Bestellung ein Abo machen" lives.
      // The webhook writes the order a moment after the sheet closes, so
      // poll briefly for it by PaymentIntent id; fall back to the list.
      const piId = clientSecret.split('_secret')[0];
      let orderId: string | null = null;
      for (let i = 0; i < 10 && !orderId; i++) {
        const { data: row } = await supabase
          .from('orders')
          .select('id')
          .eq('stripe_payment_intent_id', piId)
          .maybeSingle();
        if (row?.id) orderId = row.id;
        else await new Promise((r) => setTimeout(r, 800));
      }
      if (orderId) {
        router.replace(`/order/${orderId}`);
      } else {
        Alert.alert(
          'Zahlung erfolgreich',
          'Vielen Dank! Deine Bestellung wird bestätigt und erscheint in Kürze in deinen Bestellungen.',
        );
        router.replace('/(tabs)/orders');
      }
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  // All products are 7% VAT; prices are gross (brutto). VAT is computed on
  // the amount actually paid, the same way the website and the invoice do.
  const netCents = Math.round(payCents / 1.07);
  const vatCents = payCents - netCents;

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
                {fmt(item.unit_price_cents * item.quantity)}
              </Text>
            </View>
          ))}
          {discount && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryName}>Rabatt ({discount.code})</Text>
              <Text style={styles.summaryPrice}>−{fmt(discount.cents)}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryName}>Nettobetrag</Text>
            <Text style={styles.summaryPrice}>{fmt(netCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryName}>zzgl. 7 % MwSt.</Text>
            <Text style={styles.summaryPrice}>{fmt(vatCents)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gesamt (brutto)</Text>
            <Text style={styles.totalValue}>{fmt(payCents)}</Text>
          </View>
        </View>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Rabattcode</Text>
          <View style={styles.codeRow}>
            <TextInput
              value={codeInput}
              onChangeText={(t) => { setCodeInput(t); if (discount) setDiscount(null); setCodeError(''); }}
              placeholder="Code eingeben"
              placeholderTextColor={theme.colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.codeInput}
              editable={!codeBusy}
            />
            <TouchableOpacity style={[styles.codeButton, (!codeInput.trim() || codeBusy) && styles.codeButtonOff]} onPress={applyCode} disabled={!codeInput.trim() || codeBusy}>
              <Text style={styles.codeButtonText}>{codeBusy ? '…' : discount ? 'Eingelöst' : 'Einlösen'}</Text>
            </TouchableOpacity>
          </View>
          {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}
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
          title={`${fmt(payCents)} bezahlen`}
          onPress={handlePlaceOrder}
          loading={loading}
          size="lg"
          style={styles.payButton}
        />

        <Text style={styles.hint}>
          Sichere Zahlung über Stripe. Du erhältst nach Zahlungseingang eine Bestätigung per E-Mail.
        </Text>
        {/* § 305 Abs. 2 BGB: AGB-Hinweis am Vertragsschluss, tippbar. */}
        <Text style={styles.hint}>
          Es gelten unsere{' '}
          <Text style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(siteUrl('/agb'))}>AGB</Text>.
        </Text>
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
  codeCard: { marginBottom: theme.spacing.md },
  codeLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs },
  codeRow: { flexDirection: 'row', gap: theme.spacing.sm },
  codeInput: {
    flex: 1, borderWidth: 1, borderColor: theme.colors.cream, borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.colors.white,
    color: theme.colors.text, fontSize: theme.fontSize.md,
  },
  codeButton: { backgroundColor: theme.colors.text, borderRadius: theme.borderRadius.md, paddingHorizontal: theme.spacing.lg, justifyContent: 'center' },
  codeButtonOff: { opacity: 0.4 },
  codeButtonText: { color: theme.colors.white, fontWeight: '600', fontSize: theme.fontSize.sm },
  codeError: { marginTop: theme.spacing.xs, fontSize: theme.fontSize.xs, color: theme.colors.primary },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
