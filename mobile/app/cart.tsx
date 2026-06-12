import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { QuantitySelector } from '@/components/QuantitySelector';
import type { PickupLocation } from '@/lib/types';

export default function CartScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    items, pickup_location_id, pickup_day, totalCents, itemCount,
    updateQuantity, removeItem, clearCart, setPickupLocation,
  } = useCart();
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [showGuestForm, setShowGuestForm] = useState(false);

  useEffect(() => {
    supabase
      .from('pickup_locations')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => setLocations(data ?? []));
  }, []);

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Warenkorb ist leer</Text>
          <Text style={styles.emptyText}>Füge Produkte aus dem Shop hinzu.</Text>
          <Button title="Zum Shop" onPress={() => router.back()} variant="primary" style={styles.shopButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {items.map((item) => (
          <View key={item.product_id} style={styles.itemCard}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.product_name}</Text>
              <Text style={styles.itemPrice}>{(item.unit_price_cents / 100).toFixed(2)}€</Text>
            </View>
            <View style={styles.itemActions}>
              <QuantitySelector
                quantity={item.quantity}
                onIncrease={() => updateQuantity(item.product_id, item.quantity + 1)}
                onDecrease={() => {
                  if (item.quantity <= 1) {
                    removeItem(item.product_id);
                  } else {
                    updateQuantity(item.product_id, item.quantity - 1);
                  }
                }}
              />
              <TouchableOpacity onPress={() => removeItem(item.product_id)}>
                <Text style={styles.removeText}>Entfernen</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Abholort</Text>
          <View style={styles.locationList}>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                style={[styles.locationOption, pickup_location_id === loc.id && styles.locationOptionActive]}
                onPress={() => setPickupLocation(loc.id)}
              >
                <Text style={[styles.locationName, pickup_location_id === loc.id && styles.locationNameActive]}>
                  {loc.name}
                </Text>
                <Text style={styles.locationAddress}>{loc.address}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {pickup_day && (
          <View style={styles.pickupDayCard}>
            <Text style={styles.pickupDayTitle}>Abholung</Text>
            <Text style={styles.pickupDayValue}>
              {pickup_day === 'wednesday' ? 'Mittwoch' : 'Samstag'}
            </Text>
          </View>
        )}

        {!user && !showGuestForm && (
          <TouchableOpacity style={styles.guestToggle} onPress={() => setShowGuestForm(true)}>
            <Text style={styles.guestToggleText}>Als Gast bestellen</Text>
          </TouchableOpacity>
        )}

        {!user && showGuestForm && (
          <View style={styles.guestForm}>
            <Text style={styles.sectionTitle}>Gastinformationen</Text>
            <TextInput
              style={styles.guestInput}
              placeholder="Dein Name"
              value={guestName}
              onChangeText={setGuestName}
            />
            <TextInput
              style={styles.guestInput}
              placeholder="E-Mail-Adresse"
              value={guestEmail}
              onChangeText={setGuestEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        )}

        <View style={styles.totalSection}>
          <Text style={styles.totalLabel}>Gesamtsumme</Text>
          <Text style={styles.totalValue}>{(totalCents / 100).toFixed(2)}€</Text>
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
    </SafeAreaView>
  );
}

import { TextInput } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptyText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.lg,
  },
  shopButton: {
    minWidth: 160,
  },
  itemCard: {
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
  itemInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  itemName: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  itemPrice: {
    fontSize: theme.fontSize.md,
    color: theme.colors.secondary,
    fontWeight: '600',
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  removeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.md,
  },
  locationList: {
    gap: theme.spacing.sm,
  },
  locationOption: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
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
  pickupDayCard: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  pickupDayTitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    textTransform: 'uppercase',
  },
  pickupDayValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  guestToggle: {
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
  },
  guestToggleText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.secondary,
  },
  guestForm: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  guestInput: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.md,
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
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  checkoutButton: {
    width: '100%',
  },
});
