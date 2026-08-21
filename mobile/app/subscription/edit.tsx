import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { QuantitySelector } from '@/components/QuantitySelector';
import { LocationDropdown } from '@/components/LocationDropdown';
import type { Product, PickupLocation, WeekCycle, PickupDay } from '@/lib/types';

export default function SubscriptionEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const [{ data: sub }, { data: locs }, { data: cycle }] = await Promise.all([
        supabase
          .from('subscriptions')
          .select('pickup_day, pickup_location_id, items:subscription_items(product_id, quantity)')
          .eq('id', id)
          .single(),
        supabase.from('pickup_locations').select('*').eq('active', true).order('sort_order', { ascending: true }),
        supabase.from('week_cycle').select('*').maybeSingle(),
      ]);

      const day = (sub?.pickup_day as PickupDay) ?? 'wednesday';
      // Only offer locations that actually serve this Abo's day(s) — moving a
      // Saturday Abo to a Wednesday-only location would silently break it.
      const allLocs = (locs ?? []) as PickupLocation[];
      setLocations(
        allLocs.filter((l) =>
          day === 'wednesday' ? l.available_wed
          : day === 'saturday' ? l.available_sat
          : l.available_wed && l.available_sat,
        ),
      );
      setSelectedLocation(sub?.pickup_location_id ?? null);

      const q: Record<string, number> = {};
      for (const it of (sub?.items ?? []) as { product_id: string; quantity: number }[]) {
        q[it.product_id] = it.quantity;
      }
      setQuantities(q);

      const { data: allProducts } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .eq('subscribable', true)
        .not('cycle', 'eq', 'hidden')
        .order('sort_order', { ascending: true });
      const wc = cycle as WeekCycle | null;
      const filtered = (allProducts ?? []).filter((p) => {
        if (day !== 'saturday' && !p.available_wed) return false;
        if (day !== 'wednesday' && !p.available_sat) return false;
        if (p.cycle === 'week_a' && wc?.current_week !== 'A') return false;
        if (p.cycle === 'week_b' && wc?.current_week !== 'B') return false;
        return true;
      });
      setProducts(filtered as Product[]);
      setLoading(false);
    })();
  }, [id]);

  const handleSave = async () => {
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity }));
    if (items.length === 0) {
      Alert.alert('Fehler', 'Wähle mindestens ein Produkt aus.');
      return;
    }
    if (!selectedLocation) {
      Alert.alert('Fehler', 'Wähle einen Abholort.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('subscription-engine/update-subscription', {
      body: { subscription_id: id, items, pickup_location_id: selectedLocation },
    });
    setSaving(false);
    if (error) {
      Alert.alert('Fehler', 'Änderung fehlgeschlagen. Bitte später erneut versuchen.');
      return;
    }
    const appliedThisWeek = (data as { applied_this_week?: boolean } | null)?.applied_this_week;
    Alert.alert(
      'Abo aktualisiert',
      appliedThisWeek
        ? 'Deine anstehende, noch nicht berechnete Bestellung wurde bereits angepasst.'
        : 'Die nächste Lieferung ist bereits fixiert – deine Änderung gilt ab der Lieferung danach.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  };

  const total = Object.entries(quantities).reduce(
    (s, [pid, q]) => s + (products.find((p) => p.id === pid)?.price_cents ?? 0) * q,
    0,
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Abo bearbeiten' }} />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // No 'top' edge: the stack header already covers the status bar.
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Abo bearbeiten' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Produkte</Text>
        <Text style={styles.hint}>Ändere Mengen oder füge Produkte hinzu. Die Änderung gilt für jede Lieferung.</Text>
        {products.map((product) => (
          <View key={product.id} style={styles.productRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productPrice}>{(product.price_cents / 100).toFixed(2).replace('.', ',')} €</Text>
            </View>
            <QuantitySelector
              quantity={quantities[product.id] || 0}
              onIncrease={() => setQuantities((prev) => ({ ...prev, [product.id]: (prev[product.id] || 0) + 1 }))}
              onDecrease={() => setQuantities((prev) => ({ ...prev, [product.id]: Math.max(0, (prev[product.id] || 0) - 1) }))}
            />
          </View>
        ))}

        <Text style={[styles.h1, { marginTop: theme.spacing.xl }]}>Abholort</Text>
        <LocationDropdown locations={locations} selectedId={selectedLocation} onSelect={setSelectedLocation} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Gesamt pro Lieferung</Text>
          <Text style={styles.totalValue}>{(total / 100).toFixed(2).replace('.', ',')} €</Text>
        </View>

        <Button
          title={saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
          onPress={handleSave}
          disabled={saving}
          size="lg"
          style={{ marginTop: theme.spacing.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  h1: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.xs },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginBottom: theme.spacing.md },
  productRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.md, marginBottom: theme.spacing.sm,
  },
  productName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  productPrice: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.spacing.lg },
  totalLabel: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  totalValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
});
