import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { PickupLocation, Order } from '@/lib/types';

export default function AdminNotificationsScreen() {
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [extraText, setExtraText] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    const [locRes, ordRes] = await Promise.all([
      supabase.from('pickup_locations').select('*').eq('active', true).order('sort_order'),
      supabase.from('orders').select('*').in('status', ['locked_for_production', 'processing']).order('fulfillment_date', { ascending: true }).limit(50),
    ]);
    setLocations(locRes.data ?? []);
    setOrders(ordRes.data ?? []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSendByLocation = async () => {
    if (!selectedLocation) { Alert.alert('Fehler', 'Bitte Abholort wählen'); return; }
    setSending(true);
    const locationOrders = orders.filter((o) => o.pickup_location_id === selectedLocation);
    const location = locations.find((l) => l.id === selectedLocation);
    const template = location?.notification_template || 'Deine Bestellung #{ORDER_NUMBER} ist abholbereit unter {PICKUP_LOCATION}. {EXTRA_TEXT}';

    for (const order of locationOrders) {
      const message = template
        .replace('{ORDER_NUMBER}', order.id.slice(0, 8).toUpperCase())
        .replace('{PICKUP_LOCATION}', location?.name ?? '')
        .replace('{EXTRA_TEXT}', extraText || '');

      await supabase.from('notifications').insert({
        customer_id: order.customer_id,
        type: 'pickup_ready',
        channel: 'both',
        delivered: false,
      });
      console.log('Notification sent:', order.id, message);
    }
    setSending(false);
    Alert.alert('Gesendet', `${locationOrders.length} Benachrichtigungen wurden ausgelöst.`);
  };

  const handleSendToAll = async () => {
    setSending(true);
    for (const order of orders) {
      await supabase.from('notifications').insert({
        customer_id: order.customer_id,
        type: 'pickup_ready',
        channel: 'both',
        delivered: false,
      });
    }
    setSending(false);
    Alert.alert('Gesendet', `${orders.length} Benachrichtigungen wurden ausgelöst.`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={fetchData} />}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nach Abholort senden</Text>
          <View style={styles.locationList}>
            {locations.map((loc) => (
              <Button
                key={loc.id}
                title={loc.name}
                onPress={() => setSelectedLocation(loc.id)}
                variant={selectedLocation === loc.id ? 'primary' : 'ghost'}
                size="sm"
                style={styles.locationButton}
              />
            ))}
          </View>
          <Text style={styles.label}>Zusätzlicher Text (z. B. Schrankcode)</Text>
          <TextInput
            style={styles.input}
            value={extraText}
            onChangeText={setExtraText}
            placeholder="z. B. Abholcode: 1234"
            multiline
          />
          <Button
            title="Benachrichtigung senden"
            onPress={handleSendByLocation}
            loading={sending}
            disabled={!selectedLocation}
            style={styles.sendButton}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>An alle ausstehenden Bestellungen</Text>
          <Text style={styles.orderCount}>{orders.length} offene Bestellungen</Text>
          <Button title="An alle senden" onPress={handleSendToAll} loading={sending} variant="accent" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  section: {
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
  sectionTitle: { fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.md },
  locationList: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  locationButton: { minWidth: 100 },
  label: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs },
  input: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.md, padding: 12, fontSize: theme.fontSize.md, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.md, minHeight: 60 },
  sendButton: { marginTop: theme.spacing.sm },
  orderCount: { fontSize: theme.fontSize.md, color: theme.colors.textLight, marginBottom: theme.spacing.md },
});
