import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, type ViewStyle } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import type { Subscription, SubscriptionItem, Product, PickupLocation } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  cancellation_pending: 'Kündigung läuft',
  cancelled: 'Gekündigt',
  payment_failed: 'Zahlung fehlgeschlagen',
};

const DAY_LABELS: Record<string, string> = {
  wednesday: 'Mittwochs',
  saturday: 'Samstags',
};

export default function SubscriptionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<(Subscription & { items: (SubscriptionItem & { product: Product })[]; pickup_location: PickupLocation })[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pauseDate, setPauseDate] = useState(new Date());
  const [busyId, setBusyId] = useState<string | null>(null);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const fetchSubscriptions = useCallback(async () => {
    if (!user) { setSubscriptions([]); return; }
    const { data } = await supabase
      .from('subscriptions')
      .select('*, items:subscription_items(*, product:products(*)), pickup_location:pickup_locations(*)')
      .eq('customer_id', user.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });
    setSubscriptions((data ?? []) as any);
  }, [user]);

  useFocusEffect(useCallback(() => { fetchSubscriptions(); }, [fetchSubscriptions]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSubscriptions();
    setRefreshing(false);
  };

  const handlePause = async (subId: string) => {
    const resumeDate = pauseDate.toISOString().split('T')[0];
    // The engine also removes any not-yet-charged upcoming order so the paused
    // week isn't charged.
    const { error } = await supabase.functions.invoke('subscription-engine/pause', {
      body: { subscription_id: subId, resume_date: resumeDate },
    });
    if (error) Alert.alert('Fehler', 'Pausieren fehlgeschlagen.');
    else await fetchSubscriptions();
    setPausingId(null);
  };

  const handleResume = async (subId: string) => {
    // The engine also regenerates the upcoming order if still before its cutoff.
    const { error } = await supabase.functions.invoke('subscription-engine/resume', {
      body: { subscription_id: subId },
    });
    if (error) Alert.alert('Fehler', 'Fortsetzen fehlgeschlagen.');
    else await fetchSubscriptions();
  };

  /**
   * A failed charge left the subscription in `payment_failed` with no way out:
   * the screen rendered no buttons for that status and nothing server-side ever
   * moved it back. The customer could neither fix their card nor cancel.
   * Presenting the Stripe sheet saves a fresh card, then the subscription goes
   * active again and the next engine run generates its order.
   */
  const handleUpdatePayment = async (subId: string) => {
    setBusyId(subId);
    try {
      const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: {} });
      if (error || !data?.setupIntentClientSecret) {
        Alert.alert('Fehler', 'Zahlungsmethode konnte nicht geladen werden.');
        return;
      }
      const init = await initPaymentSheet({
        merchantDisplayName: 'Smittenbrot',
        setupIntentClientSecret: data.setupIntentClientSecret,
        customerId: data.customerId,
        customerEphemeralKeySecret: data.ephemeralKey,
        returnURL: 'smittenbrot://stripe-redirect',
        // Same wallets as when the subscription was created — otherwise someone
        // who paid with Apple Pay could only switch to a plain card here.
        applePay: {
          merchantCountryCode: 'DE',
        },
        googlePay: {
          merchantCountryCode: 'DE',
          currencyCode: 'EUR',
          testEnv: !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live'),
        },
      });
      if (init.error) {
        Alert.alert('Fehler', init.error.message);
        return;
      }
      const { error: sheetError } = await presentPaymentSheet();
      if (sheetError) {
        if (sheetError.code !== 'Canceled') Alert.alert('Fehler', sheetError.message);
        return;
      }
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({ status: 'active' })
        .eq('id', subId);
      if (updateError) {
        Alert.alert('Fehler', updateError.message);
        return;
      }
      Alert.alert(
        'Zahlungsmethode gespeichert',
        'Dein Abo ist wieder aktiv. Die nächste Bestellung wird automatisch erstellt.',
      );
      await fetchSubscriptions();
    } finally {
      setBusyId(null);
    }
  };

  /** The cancel dialog promises this is reversible, but nothing offered it. */
  const handleUndoCancel = async (subId: string) => {
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'active' })
      .eq('id', subId);
    if (error) Alert.alert('Fehler', error.message);
    else await fetchSubscriptions();
  };

  const handleCancel = (subId: string) => {
    Alert.alert(
      'Abonnement kündigen',
      'Möchtest du dein Abonnement wirklich kündigen? Du kannst dies bis 22:00 Uhr am Bestelltag rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Kündigen',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('subscriptions')
              .update({ status: 'cancellation_pending' })
              .eq('id', subId);
            if (error) Alert.alert('Fehler', error.message);
            else fetchSubscriptions();
          },
        },
      ]
    );
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
        <Text style={styles.title}>Abonnements</Text>
        <Button
          title="Neues Abo"
          onPress={() => router.push('/subscription/create')}
          variant="accent"
          size="sm"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {subscriptions.some((s) => s.status === 'active' || s.status === 'paused') && (
          <Text style={styles.helpText}>
            Tippe auf „Bearbeiten", um Produkte, Mengen oder den Abholort zu ändern.
          </Text>
        )}

        {subscriptions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Noch keine Abonnements</Text>
            <Button
              title="Abonnement erstellen"
              onPress={() => router.push('/subscription/create')}
              variant="primary"
              style={styles.emptyButton}
            />
          </View>
        ) : (
          subscriptions.map((sub) => (
            <View key={sub.id} style={styles.subCard}>
              <View style={styles.subHeader}>
                <View style={[styles.statusDot, (styles[`statusDot_${sub.status}` as keyof typeof styles] as ViewStyle) || styles.statusDot_active]}>
                  <View />
                </View>
                <Text style={styles.subStatus}>{STATUS_LABELS[sub.status]}</Text>
              </View>

              {sub.items?.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName}>{item.product?.name}</Text>
                  <Text style={styles.itemQty}>{item.quantity}×</Text>
                </View>
              ))}

              <Text style={styles.subLocation}>
                {DAY_LABELS[sub.pickup_day] ?? ''} · Abholung: {sub.pickup_location?.name}
              </Text>

              {sub.status === 'active' && (
                <View style={styles.actionRow}>
                  {pausingId === sub.id ? (
                    <View style={styles.pauseBox}>
                      <Text style={styles.pauseLabel}>Bis wann möchtest du pausieren?</Text>
                      <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                        <Text style={styles.dateButtonText}>
                          {pauseDate.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </Text>
                        <Ionicons name="calendar-outline" size={18} color={theme.colors.textLight} />
                      </TouchableOpacity>
                      <Text style={styles.pauseHint}>Dein Abo wird an diesem Tag automatisch fortgesetzt.</Text>
                      {showDatePicker && (
                        <DateTimePicker
                          value={pauseDate}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          minimumDate={new Date()}
                          onChange={(_, date) => {
                            setShowDatePicker(false);
                            if (date) setPauseDate(date);
                          }}
                        />
                      )}
                      <View style={styles.pauseActions}>
                        <Button title="Pause bestätigen" onPress={() => handlePause(sub.id)} size="sm" style={styles.pauseConfirm} />
                        <Button title="Abbrechen" onPress={() => setPausingId(null)} variant="ghost" size="sm" />
                      </View>
                    </View>
                  ) : (
                    <>
                      <Button title="Bearbeiten" onPress={() => router.push(`/subscription/edit?id=${sub.id}`)} variant="ghost" size="sm" />
                      <Button title="Pausieren" onPress={() => setPausingId(sub.id)} variant="ghost" size="sm" />
                      <Button title="Kündigen" onPress={() => handleCancel(sub.id)} variant="danger" size="sm" />
                    </>
                  )}
                </View>
              )}

              {sub.status === 'paused' && (
                <View style={styles.pausedActions}>
                  <Button title="Bearbeiten" onPress={() => router.push(`/subscription/edit?id=${sub.id}`)} variant="ghost" size="sm" />
                  <Button title="Fortsetzen" onPress={() => handleResume(sub.id)} variant="primary" size="sm" style={styles.resumeButton} />
                </View>
              )}

              {sub.status === 'payment_failed' && (
                <View style={styles.actionRow}>
                  <Text style={styles.statusHint}>
                    Die letzte Zahlung hat nicht funktioniert. Hinterlege eine Zahlungsmethode,
                    dann läuft dein Abo weiter.
                  </Text>
                  <Button
                    title="Zahlungsmethode aktualisieren"
                    onPress={() => handleUpdatePayment(sub.id)}
                    loading={busyId === sub.id}
                    size="sm"
                  />
                  <View style={styles.pausedActions}>
                    <Button title="Bearbeiten" onPress={() => router.push(`/subscription/edit?id=${sub.id}`)} variant="ghost" size="sm" />
                    <Button title="Kündigen" onPress={() => handleCancel(sub.id)} variant="danger" size="sm" />
                  </View>
                </View>
              )}

              {sub.status === 'cancellation_pending' && (
                <View style={styles.actionRow}>
                  <Text style={styles.statusHint}>
                    Deine Kündigung wird bearbeitet. Du kannst sie zurücknehmen, solange sie
                    noch nicht abgeschlossen ist.
                  </Text>
                  <Button title="Kündigung zurücknehmen" onPress={() => handleUndoCancel(sub.id)} variant="ghost" size="sm" />
                </View>
              )}
            </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingTop: 0,
    paddingBottom: theme.spacing.xxl,
  },
  helpText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.md,
    lineHeight: 20,
  },
  subCard: {
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
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing.sm,
  },
  statusDot_active: { backgroundColor: theme.colors.success },
  statusDot_paused: { backgroundColor: theme.colors.accent },
  statusDot_cancellation_pending: { backgroundColor: '#F59E0B' },
  statusDot_cancelled: { backgroundColor: theme.colors.textLight },
  statusDot_payment_failed: { backgroundColor: theme.colors.error },
  subStatus: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textLight,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  itemName: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  itemQty: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.secondary,
  },
  subLocation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    flexWrap: 'wrap',
  },
  pauseBox: {
    flex: 1,
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  pauseLabel: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  dateButtonText: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '500' },
  pauseHint: { fontSize: theme.fontSize.xs, color: theme.colors.textLight },
  pauseActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  pausedActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  statusHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    lineHeight: 20,
  },
  pauseConfirm: { flex: 1 },
  resumeButton: {
    marginTop: theme.spacing.md,
  },
  emptyContainer: {
    alignItems: 'center',
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
    marginBottom: theme.spacing.lg,
  },
  emptyButton: {
    minWidth: 200,
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
