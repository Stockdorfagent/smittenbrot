import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { theme } from '@/lib/theme';
import { formatPrice } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { QuantitySelector } from '@/components/QuantitySelector';
import { LocationDropdown } from '@/components/LocationDropdown';
import type { Product, PickupLocation, WeekCycle } from '@/lib/types';
import type { PickupDay } from '@/lib/types';

type Step = 'location' | 'pickup_day' | 'products' | 'review';

/** The single source of truth for the order. The progress dots used to carry
 *  their own hardcoded list, which still had the pre-reorder sequence in it. */
const STEPS: { key: Step; label: string }[] = [
  { key: 'location', label: 'Abholort' },
  { key: 'pickup_day', label: 'Abholtag' },
  { key: 'products', label: 'Produkte' },
  { key: 'review', label: 'Prüfen' },
];

const DAY_LABELS: Record<PickupDay, string> = {
  wednesday: 'Mittwoch',
  saturday: 'Samstag',
  both: 'Mittwoch + Samstag',
};

export default function SubscriptionCreateScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [step, setStep] = useState<Step>('location');
  // Steps already completed stay tappable — going back to change one product
  // should not mean starting over.
  const [maxStep, setMaxStep] = useState(0);
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  // Set once an Abo has been created, so a re-focus can clean up even if the
  // screen was never unmounted.
  const completedRef = useRef(false);

  const resetWizard = useCallback(() => {
    completedRef.current = true;
    setStep('location');
    setMaxStep(0);
    setQuantities({});
    setPickupDay('wednesday');
  }, []);

  // Reopening after a completed Abo starts fresh; reopening a half-finished one
  // resumes where it left off.
  useFocusEffect(
    useCallback(() => {
      if (completedRef.current) {
        completedRef.current = false;
        setStep('location');
        setMaxStep(0);
        setQuantities({});
        setPickupDay('wednesday');
      }
    }, []),
  );
  const goToStep = (next: Step) => {
    const i = STEPS.findIndex((s) => s.key === next);
    setMaxStep((m) => Math.max(m, i));
    setStep(next);
  };
  const [pickupDay, setPickupDay] = useState<PickupDay>('wednesday');
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [weekCycle, setWeekCycle] = useState<WeekCycle | null>(null);
  const [loading, setLoading] = useState(false);

  // Which days this location actually offers. Only Waldstr. has a Saturday
  // pickup today, so Saturday (and Wed+Sa) must not even be selectable
  // elsewhere — the location's own flags decide, not a hardcoded name.
  const location = locations.find((l) => l.id === selectedLocation);
  const dayOptions = useMemo(() => {
    const opts: { value: PickupDay; label: string }[] = [];
    if (location?.available_wed) opts.push({ value: 'wednesday', label: DAY_LABELS.wednesday });
    if (location?.available_sat) opts.push({ value: 'saturday', label: DAY_LABELS.saturday });
    if (location?.available_wed && location?.available_sat) {
      opts.push({ value: 'both', label: DAY_LABELS.both });
    }
    return opts.length > 0 ? opts : [{ value: 'wednesday' as PickupDay, label: DAY_LABELS.wednesday }];
  }, [location?.available_wed, location?.available_sat]);

  // Switching to a location that does not offer the chosen day must not leave
  // an impossible combination behind.
  useEffect(() => {
    if (!dayOptions.some((o) => o.value === pickupDay)) {
      setPickupDay(dayOptions[0].value);
    }
  }, [dayOptions, pickupDay]);

  useEffect(() => {
    (async () => {
      const { data: locs } = await supabase
        .from('pickup_locations')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const list = (locs ?? []) as PickupLocation[];
      setLocations(list);

      // Default to the account's preferred pickup location (Stockdorf fallback).
      if (list.length > 0 && user) {
        const { data: profile } = await supabase
          .from('customers')
          .select('preferred_pickup_location_id')
          .eq('id', user.id)
          .maybeSingle();
        const pref = profile?.preferred_pickup_location_id
          ? list.find((l) => l.id === profile.preferred_pickup_location_id)
          : undefined;
        const stockdorf = list.find((l) => /stockdorf|waldstr/i.test(`${l.name} ${l.address}`));
        setSelectedLocation((pref ?? stockdorf ?? list[0]).id);
      }

      const { data: cycle } = await supabase.from('week_cycle').select('*').maybeSingle();
      setWeekCycle(cycle as WeekCycle | null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchProducts = useCallback(async () => {
    const { data: allProducts } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .eq('subscribable', true)
      .not('cycle', 'eq', 'hidden')
      .order('sort_order', { ascending: true });

    if (!allProducts) return;

    const filtered = allProducts.filter((p) => {
      if (pickupDay !== 'saturday' && !p.available_wed) return false;
      if (pickupDay !== 'wednesday' && !p.available_sat) return false;
      if (p.cycle === 'week_a' && weekCycle?.current_week !== 'A') return false;
      if (p.cycle === 'week_b' && weekCycle?.current_week !== 'B') return false;
      return true;
    });

    setProducts(filtered);
  }, [pickupDay, weekCycle]);

  useEffect(() => {
    if (step === 'products') fetchProducts();
  }, [step, fetchProducts]);

  const handleConfirm = async () => {
    if (!user || !selectedLocation) return;

    const items = Object.entries(quantities).filter(([_, qty]) => qty > 0);
    if (items.length === 0) {
      Alert.alert('Fehler', 'Wähle mindestens ein Produkt aus.');
      return;
    }

    setLoading(true);
    try {
      // 0. A subscription must have an active saved card so the weekly cron
      //    can charge it. Ensure one exists before creating the subscription.
      const { data: si, error: siError } = await supabase.functions.invoke(
        'create-setup-intent',
        { body: {} },
      );
      if (siError) {
        let message = 'Zahlungsmethode konnte nicht vorbereitet werden.';
        if (siError instanceof FunctionsHttpError) {
          try {
            const b = await siError.context.json();
            message = b?.error ?? message;
          } catch {
            /* keep default message */
          }
        }
        Alert.alert('Fehler', message);
        return;
      }

      if (si && !si.hasPaymentMethod) {
        const init = await initPaymentSheet({
          merchantDisplayName: 'Smittenbrot',
          setupIntentClientSecret: si.setupIntentClientSecret,
          customerId: si.customerId,
          customerEphemeralKeySecret: si.ephemeralKey,
          returnURL: 'smittenbrot://stripe-redirect',
          googlePay: {
            merchantCountryCode: 'DE',
            currencyCode: 'EUR',
            // Test env on Stripe test keys; auto-flips to production at launch.
            testEnv: !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live'),
          },
        });
        if (init.error) {
          Alert.alert('Fehler', init.error.message);
          return;
        }
        const { error: sheetError } = await presentPaymentSheet();
        if (sheetError) {
          // No card saved → do NOT create the subscription.
          if (sheetError.code !== 'Canceled') {
            Alert.alert('Zahlungsmethode erforderlich', sheetError.message);
          }
          return;
        }
      }

      // 1. Card is now on file — create the subscription.
      const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .insert({
          customer_id: user.id,
          status: 'active',
          pickup_day: pickupDay,
          pickup_location_id: selectedLocation,
        })
        .select()
        .single();

      if (subError || !sub) {
        Alert.alert('Fehler', subError?.message ?? 'Abonnement konnte nicht erstellt werden');
        return;
      }

      const subItems = items.map(([productId, qty]) => ({
        subscription_id: sub.id,
        product_id: productId,
        quantity: qty,
      }));

      const { error: itemsError } = await supabase
        .from('subscription_items')
        .insert(subItems);

      if (itemsError) {
        Alert.alert('Fehler', itemsError.message);
        return;
      }

      // 2. Generate the concrete order for the next pickup right away so it
      //    shows up immediately (reserves capacity, changeable until the 22:00
      //    cutoff, charged then). Best-effort — the weekly cron is the backstop.
      try {
        await supabase.functions.invoke('subscription-engine/process-single-subscription', {
          body: { subscription_id: sub.id },
        });
      } catch {
        /* ignore — the scheduled run will generate it */
      }

      Alert.alert('Abonnement erstellt', 'Dein Abonnement ist aktiv. Deine erste Bestellung ist bereits vorgemerkt.', [
        {
          text: 'OK',
          onPress: () => {
            // Finished: the next "Neues Abo" must start from the beginning.
            // Leaving mid-way and coming back still resumes — that is wanted —
            // but a completed one must not linger.
            resetWizard();
            router.back();
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const subTotalCents = Object.entries(quantities).reduce(
    (sum, [pid, qty]) => sum + (products.find((p) => p.id === pid)?.price_cents ?? 0) * qty,
    0,
  );

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.notLoggedIn}>Bitte melde dich an, um ein Abonnement zu erstellen.</Text>
          <Button title="Anmelden" onPress={() => router.push('/login')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.progressBar}>
        {STEPS.map((s, i) => {
          const reachable = i <= maxStep;
          return (
            <TouchableOpacity
              key={s.key}
              style={styles.progressStep}
              disabled={!reachable}
              onPress={() => goToStep(s.key)}
              accessibilityLabel={`Schritt ${i + 1}: ${s.label}`}
            >
              <View style={[
                styles.progressDot,
                i === stepIndex && styles.progressDotActive,
                i < stepIndex && styles.progressDotCompleted,
              ]}>
                <Text style={styles.progressNum}>{i + 1}</Text>
              </View>
              <Text style={[styles.progressLabel, i === stepIndex && styles.progressLabelActive]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {step === 'pickup_day' && (
          <View>
            <Text style={styles.stepTitle}>Abholtag wählen</Text>
            <Text style={styles.stepHint}>
              {dayOptions.length > 1
                ? 'An welchem Tag möchtest du regelmäßig abholen?'
                : `An diesem Abholort wird ${dayOptions[0]?.label ?? 'mittwochs'} abgeholt.`}
            </Text>
            {dayOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.dayOption, pickupDay === opt.value && styles.dayOptionActive]}
                onPress={() => setPickupDay(opt.value)}
              >
                <Text style={[styles.dayOptionText, pickupDay === opt.value && styles.dayOptionTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            <Button title="Weiter" onPress={() => goToStep('products')} size="lg" style={styles.nextButton} />
            <Button title="Zurück" onPress={() => goToStep('location')} variant="ghost" size="sm" style={styles.backButton} />
          </View>
        )}

        {step === 'products' && (
          <View>
            <Text style={styles.stepTitle}>Produkte auswählen</Text>
            <Text style={styles.stepHint}>Wähle die Produkte und Mengen für dein Abonnement.</Text>
            {products.map((product) => (
              <View key={product.id} style={styles.productRow}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productPrice}>{formatPrice(product.price_cents)}</Text>
                </View>
                <QuantitySelector
                  quantity={quantities[product.id] || 0}
                  onIncrease={() => setQuantities((prev) => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }))}
                  onDecrease={() => setQuantities((prev) => ({ ...prev, [product.id]: Math.max(0, (prev[product.id] || 0) - 1) }))}
                />
              </View>
            ))}
            <Button title="Weiter" onPress={() => goToStep('review')} size="lg" style={styles.nextButton} />
            <Button title="Zurück" onPress={() => goToStep('pickup_day')} variant="ghost" size="sm" style={styles.backButton} />
          </View>
        )}

        {step === 'location' && (
          <View>
            <Text style={styles.stepTitle}>Abholort wählen</Text>
            <Text style={styles.stepHint}>Wo möchtest du deine Bestellungen abholen?</Text>
            <LocationDropdown
              locations={locations}
              selectedId={selectedLocation}
              onSelect={setSelectedLocation}
            />
            <Button title="Weiter" onPress={() => goToStep('pickup_day')} size="lg" disabled={!selectedLocation} style={styles.nextButton} />
          </View>
        )}

        {step === 'review' && (
          <View>
            <Text style={styles.stepTitle}>Überprüfen & Bestätigen</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Abholtag</Text>
              <Text style={styles.reviewValue}>{DAY_LABELS[pickupDay]}</Text>
            </View>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Abholort</Text>
              <Text style={styles.reviewValue}>{locations.find((l) => l.id === selectedLocation)?.name}</Text>
            </View>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Produkte</Text>
              {Object.entries(quantities).filter(([_, qty]) => qty > 0).map(([productId, qty]) => {
                const product = products.find((p) => p.id === productId);
                return (
                  <View key={productId} style={styles.reviewProductRow}>
                    <Text style={styles.reviewProductName}>{product?.name} ×{qty}</Text>
                    <Text style={styles.reviewProductPrice}>
                      {(((product?.price_cents ?? 0) * qty) / 100).toFixed(2).replace('.', ',')} €
                    </Text>
                  </View>
                );
              })}
              <View style={styles.reviewTotalRow}>
                <Text style={styles.reviewTotalLabel}>Gesamt pro Lieferung</Text>
                <Text style={styles.reviewTotalValue}>{(subTotalCents / 100).toFixed(2).replace('.', ',')} €</Text>
              </View>
            </View>
            <Text style={styles.reviewHint}>
              Wird bei jeder Lieferung berechnet. Enthält 7 % MwSt.
            </Text>
            <Button title="Abonnement erstellen" onPress={handleConfirm} loading={loading} size="lg" style={styles.nextButton} />
            <Button title="Zurück" onPress={() => goToStep('products')} variant="ghost" size="sm" style={styles.backButton} />
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  notLoggedIn: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textLight,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  progressBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  progressStep: {
    alignItems: 'center',
  },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotActive: {
    backgroundColor: theme.colors.primary,
  },
  progressDotCompleted: {
    backgroundColor: theme.colors.accent,
  },
  progressNum: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.white,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  stepTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
    marginBottom: theme.spacing.sm,
  },
  stepHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.lg,
  },
  dayOption: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  dayOptionActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.cream,
  },
  dayOptionText: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
  },
  dayOptionTextActive: {
    color: theme.colors.primary,
  },
  productRow: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  productPrice: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.secondary,
    marginTop: theme.spacing.xs,
  },
  locationOption: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  locationOptionActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.cream,
  },
  locationName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  locationNameActive: {
    color: theme.colors.primary,
  },
  locationAddress: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  reviewCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  reviewLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  reviewValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  reviewProductRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
  },
  reviewProductName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  reviewProductPrice: {
    fontSize: theme.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.secondary,
  },
  reviewTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  reviewTotalLabel: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  reviewTotalValue: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  reviewHint: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, marginBottom: theme.spacing.sm, marginTop: theme.spacing.xs },
  nextButton: {
    marginTop: theme.spacing.lg,
  },
  backButton: {
    marginTop: theme.spacing.sm,
  },
  progressLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  progressLabelActive: {
    color: theme.colors.text,
    fontWeight: '600',
  },
});
