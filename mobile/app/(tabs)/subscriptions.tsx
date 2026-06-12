import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
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

export default function SubscriptionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<(Subscription & { items: (SubscriptionItem & { product: Product })[]; pickup_location: PickupLocation })[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pauseDate, setPauseDate] = useState(new Date());

  const fetchSubscriptions = useCallback(async () => {
    if (!user) { setSubscriptions([]); return; }
    const { data } = await supabase
      .from('subscriptions')
      .select('*, items:subscription_items(*, product:products(*)), pickup_location:pickup_locations(*)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });
    setSubscriptions((data ?? []) as any);
  }, [user]);

  useEffect(() => { fetchSubscriptions(); }, [fetchSubscriptions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSubscriptions();
    setRefreshing(false);
  };

  const handlePause = async (subId: string) => {
    const resumeDate = pauseDate.toISOString().split('T')[0];
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'paused', paused_until: resumeDate })
      .eq('id', subId);
    if (error) {
      Alert.alert('Fehler', error.message);
    } else {
      fetchSubscriptions();
    }
    setPausingId(null);
  };

  const handleResume = async (subId: string) => {
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'active', paused_until: null })
      .eq('id', subId);
    if (error) Alert.alert('Fehler', error.message);
    else fetchSubscriptions();
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
                <View style={[styles.statusDot, styles[`statusDot_${sub.status}` as keyof typeof styles] || styles.statusDot_active]}>
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
                Abholung: {sub.pickup_location?.name}
              </Text>

              {sub.status === 'active' && (
                <View style={styles.actionRow}>
                  {pausingId === sub.id ? (
                    <View style={styles.pauseRow}>
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
                      <Button
                        title="Datum wählen"
                        onPress={() => setShowDatePicker(true)}
                        variant="ghost"
                        size="sm"
                      />
                      <Button title="Pausieren" onPress={() => handlePause(sub.id)} size="sm" />
                      <Button title="Abbrechen" onPress={() => setPausingId(null)} variant="ghost" size="sm" />
                    </View>
                  ) : (
                    <>
                      <Button title="Pausieren" onPress={() => setPausingId(sub.id)} variant="ghost" size="sm" />
                      <Button title="Kündigen" onPress={() => handleCancel(sub.id)} variant="danger" size="sm" />
                    </>
                  )}
                </View>
              )}

              {sub.status === 'paused' && (
                <Button title="Fortsetzen" onPress={() => handleResume(sub.id)} variant="primary" size="sm" style={styles.resumeButton} />
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
  pauseRow: {
    flex: 1,
    gap: theme.spacing.sm,
  },
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
