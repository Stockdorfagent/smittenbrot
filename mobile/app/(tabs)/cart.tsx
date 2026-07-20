import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { getNextPickup } from '@/lib/pickup';
import { Button } from '@/components/Button';
import { QuantitySelector } from '@/components/QuantitySelector';
import type { PickupLocation } from '@/lib/types';

export default function CartScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    items, pickup_location_id, totalCents, itemCount,
    updateQuantity, removeItem, setPickupLocation,
  } = useCart();
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const pickup = getNextPickup();

  useEffect(() => {
    (async () => {
      const { data: locs } = await supabase
        .from('pickup_locations')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const list = (locs ?? []) as PickupLocation[];
      setLocations(list);

      // Default the pickup location: the account's preferred one, else the
      // Stockdorf location, else the first available.
      if (!pickup_location_id && list.length > 0) {
        let def = list[0];
        if (user) {
          const { data: profile } = await supabase
            .from('customers')
            .select('preferred_pickup_location_id')
            .eq('id', user.id)
            .maybeSingle();
          const pref = profile?.preferred_pickup_location_id
            ? list.find((l) => l.id === profile.preferred_pickup_location_id)
            : undefined;
          const stockdorf = list.find(
            (l) => /stockdorf|waldstr/i.test(`${l.name} ${l.address}`),
          );
          def = pref ?? stockdorf ?? list[0];
        }
        setPickupLocation(def.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const selected = locations.find((l) => l.id === pickup_location_id);

  // All Smittenbrot products are 7% VAT and prices are gross (brutto).
  const grossCents = totalCents;
  const netCents = Math.round(grossCents / 1.07);
  const vatCents = grossCents - netCents;
  const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Warenkorb ist leer</Text>
          <Text style={styles.emptyText}>Füge Produkte auf der Startseite hinzu.</Text>
          <Button title="Zur Startseite" onPress={() => router.push('/(tabs)')} variant="primary" style={styles.shopButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Warenkorb</Text>

        {items.map((item) => (
          <View key={item.product_id} style={styles.itemCard}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.product_name}</Text>
              <Text style={styles.itemPrice}>{fmt(item.unit_price_cents * item.quantity)}</Text>
            </View>
            <View style={styles.itemActions}>
              <QuantitySelector
                quantity={item.quantity}
                onIncrease={() => updateQuantity(item.product_id, item.quantity + 1)}
                onDecrease={() => item.quantity <= 1 ? removeItem(item.product_id) : updateQuantity(item.product_id, item.quantity - 1)}
              />
              <TouchableOpacity onPress={() => removeItem(item.product_id)}>
                <Text style={styles.removeText}>Entfernen</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Abholort dropdown */}
        <Text style={styles.sectionTitle}>Abholort</Text>
        <TouchableOpacity style={styles.dropdown} onPress={() => setDropdownOpen(true)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dropdownName}>{selected?.name ?? 'Abholort wählen'}</Text>
            {selected?.address ? <Text style={styles.dropdownAddress}>{selected.address}</Text> : null}
          </View>
          <Ionicons name="chevron-down" size={20} color={theme.colors.textLight} />
        </TouchableOpacity>

        <View style={styles.pickupDayCard}>
          <Text style={styles.pickupDayTitle}>Abholung</Text>
          <Text style={styles.pickupDayValue}>{pickup.label} · {pickup.cutoffLabel}</Text>
        </View>

        {/* Total with VAT breakdown (German tax law) */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelSmall}>Nettobetrag</Text>
            <Text style={styles.totalValueSmall}>{fmt(netCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelSmall}>zzgl. 7 % MwSt.</Text>
            <Text style={styles.totalValueSmall}>{fmt(vatCents)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gesamt (brutto)</Text>
            <Text style={styles.totalValue}>{fmt(grossCents)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button
          title="Zur Kasse"
          onPress={() => router.push('/checkout')}
          size="lg"
          disabled={!pickup_location_id}
          style={styles.checkoutButton}
        />
      </View>

      {/* Location picker modal */}
      <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDropdownOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Abholort wählen</Text>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                style={styles.modalOption}
                onPress={() => { setPickupLocation(loc.id); setDropdownOpen(false); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalOptionName}>{loc.name}</Text>
                  <Text style={styles.modalOptionAddress}>{loc.address}</Text>
                </View>
                {loc.id === pickup_location_id && (
                  <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.lg, paddingBottom: 100 },
  heading: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.lg },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: theme.fontSize.xl, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.sm },
  emptyText: { fontSize: theme.fontSize.md, color: theme.colors.textLight, marginBottom: theme.spacing.lg },
  shopButton: { minWidth: 160 },
  itemCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  itemInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
  itemName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text, flex: 1 },
  itemPrice: { fontSize: theme.fontSize.md, color: theme.colors.text, fontWeight: '600' },
  itemActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  removeText: { fontSize: theme.fontSize.sm, color: theme.colors.error },
  sectionTitle: {
    fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm, marginTop: theme.spacing.sm,
  },
  dropdown: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.md, marginBottom: theme.spacing.md,
  },
  dropdownName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  dropdownAddress: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  pickupDayCard: {
    backgroundColor: theme.colors.cream, borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md, marginBottom: theme.spacing.md,
  },
  pickupDayTitle: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, textTransform: 'uppercase' },
  pickupDayValue: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text, marginTop: 2 },
  totalCard: {
    backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.lg,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.lg, marginTop: theme.spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  totalLabelSmall: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  totalValueSmall: { fontSize: theme.fontSize.sm, color: theme.colors.text },
  totalDivider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.sm },
  totalLabel: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  totalValue: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: theme.spacing.md, paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  checkoutButton: { width: '100%' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl,
  },
  modalTitle: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
  modalOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  modalOptionName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  modalOptionAddress: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
});
