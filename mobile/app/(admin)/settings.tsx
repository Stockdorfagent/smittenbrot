import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { WeekCycle } from '@/lib/types';

export default function AdminSettingsScreen() {
  const [weekCycle, setWeekCycle] = useState<WeekCycle | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCycle = useCallback(async () => {
    const { data } = await supabase.from('week_cycle').select('*').maybeSingle();
    setWeekCycle(data);
  }, []);

  useEffect(() => { fetchCycle(); }, [fetchCycle]);

  const toggleWeek = async () => {
    if (!weekCycle) return;
    setLoading(true);
    const newWeek = weekCycle.current_week === 'A' ? 'B' : 'A';
    const { error } = await supabase
      .from('week_cycle')
      .update({ current_week: newWeek, switched_at: new Date().toISOString() })
      .eq('id', weekCycle.id);
    setLoading(false);
    if (error) Alert.alert('Fehler', error.message);
    else fetchCycle();
  };

  const handleExport = async () => {
    const tables = ['orders', 'order_items', 'products', 'subscriptions', 'subscription_items', 'customers', 'pickup_locations', 'closures', 'notifications'];
    for (const table of tables) {
      const { data } = await supabase.from(table).select('*');
      console.log(`Export ${table}:`, JSON.stringify(data ?? [], null, 2));
    }
    Alert.alert('Export', 'Daten wurden in der Konsole ausgegeben. CSV-Export folgt in einer späteren Version.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wochenzyklus</Text>
          {weekCycle && (
            <View style={styles.cycleCard}>
              <Text style={styles.cycleLabel}>Aktuelle Woche</Text>
              <Text style={styles.cycleValue}>{weekCycle.current_week}</Text>
              <Text style={styles.cycleInfo}>
                Zuletzt gewechselt: {new Date(weekCycle.switched_at).toLocaleDateString('de-DE')}
              </Text>
              <Button
                title={`Zu Woche ${weekCycle.current_week === 'A' ? 'B' : 'A'} wechseln`}
                onPress={toggleWeek}
                loading={loading}
                variant="accent"
                style={styles.toggleButton}
              />
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Datenexport</Text>
          <Text style={styles.hint}>
            Alle Daten als CSV exportieren (aktuell: Konsolenausgabe).
          </Text>
          <Button title="Exportieren" onPress={handleExport} variant="secondary" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Systeminfo</Text>
          <InfoRow label="Zeitzone" value="Europe/Berlin" />
          <InfoRow label="MWSt" value="7%" />
          <InfoRow label="App-Version" value="1.0.0" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  cycleCard: { alignItems: 'center', padding: theme.spacing.md },
  cycleLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  cycleValue: { fontSize: 48, fontWeight: '700', color: theme.colors.primary, fontFamily: theme.fontFamily.display, marginVertical: theme.spacing.sm },
  cycleInfo: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, marginBottom: theme.spacing.md },
  toggleButton: { minWidth: 180 },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginBottom: theme.spacing.md },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  infoLabel: { fontSize: theme.fontSize.md, color: theme.colors.textLight },
  infoValue: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '500' },
});
