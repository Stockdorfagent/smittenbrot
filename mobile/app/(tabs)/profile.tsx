import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { LocationDropdown } from '@/components/LocationDropdown';
import { ReminderSettings } from '@/components/ReminderSettings';
import type { PickupLocation } from '@/lib/types';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, refreshUser } = useAuth();
  const [deleting, setDeleting] = useState(false);

  // Editable profile fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLocation, setPreferredLocation] = useState<string | null>(null);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: customer }, { data: locs }] = await Promise.all([
        supabase.from('customers')
          .select('name, phone, preferred_pickup_location_id')
          .eq('id', user.id).single(),
        supabase.from('pickup_locations')
          .select('*').eq('active', true).order('sort_order', { ascending: true }),
      ]);
      if (customer) {
        setName(customer.name ?? '');
        setPhone(customer.phone ?? '');
        setPreferredLocation(customer.preferred_pickup_location_id ?? null);
      }
      if (locs) setLocations(locs);
      setLoading(false);
    })();
  }, [user?.id]);

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);
    setSaved(false);
    const { error } = await supabase.from('customers').upsert({
      id: user.id,
      email: user.email,
      name: name.trim(),
      phone: phone.trim() || null,
      preferred_pickup_location_id: preferredLocation,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Fehler', 'Speichern fehlgeschlagen. Bitte später erneut versuchen.');
      return;
    }
    await refreshUser();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Konto löschen?',
      'Dein Konto und deine persönlichen Daten (Profil, gespeicherte Zahlungsmethode, Abos) werden gelöscht. Rechnungen bewahren wir aus gesetzlichen Gründen 8 Jahre auf. Dies kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Konto löschen',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await supabase.functions.invoke('delete-account', { body: {} });
            setDeleting(false);
            if (error) {
              Alert.alert('Fehler', 'Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.');
              return;
            }
            await signOut();
            router.replace('/login');
          },
        },
      ],
    );
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.notLoggedInTitle}>Nicht angemeldet</Text>
          <Text style={styles.notLoggedInText}>Melde dich an, um dein Profil zu sehen.</Text>
          <Button title="Anmelden" onPress={() => router.push('/login')} size="lg" style={styles.loginButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Konto</Text>
          <ProfileRow label="E-Mail" value={user.email} />
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.md }} />
          ) : (
            <View style={{ marginTop: theme.spacing.md }}>
              <Input label="Vor- und Nachname" value={name} onChangeText={setName} placeholder="z. B. Sophia Smittenberg" />
              <Input label="Telefon (optional)" value={phone} onChangeText={setPhone}
                placeholder="Für Rückfragen zur Abholung" keyboardType="phone-pad" />
              <Text style={styles.fieldLabel}>Bevorzugter Abholort</Text>
              <LocationDropdown locations={locations} selectedId={preferredLocation} onSelect={setPreferredLocation} />
              <Button
                title={saving ? 'Wird gespeichert…' : saved ? '✓ Gespeichert' : 'Speichern'}
                onPress={handleSave}
                disabled={saving || !name.trim()}
                size="md"
                style={{ marginTop: theme.spacing.md }}
              />
            </View>
          )}
        </View>

        <ReminderSettings />

        {user.is_admin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Administration</Text>
            <TouchableOpacity style={styles.row} onPress={() => router.push('/admin-bakeday')}>
              <Text style={styles.rowLabel}>Backtag-Übersicht</Text>
              <Text style={styles.rowArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Einstellungen</Text>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/(tabs)/orders')}>
            <Text style={styles.rowLabel}>Bestellhistorie</Text>
            <Text style={styles.rowArrow}>→</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Button
            title="Abmelden"
            onPress={async () => {
              await signOut();
              router.replace('/login');
            }}
            variant="danger"
            size="md"
          />
        </View>

        <TouchableOpacity
          style={styles.deleteRow}
          onPress={handleDeleteAccount}
          disabled={deleting}
        >
          <Text style={styles.deleteText}>
            {deleting ? 'Wird gelöscht…' : 'Konto löschen'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.colors.white,
  },
  name: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    fontFamily: theme.fontFamily.display,
  },
  email: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
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
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.md,
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
  },
  rowValue: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textLight,
  },
  rowArrow: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textLight,
  },
  notLoggedInTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  notLoggedInText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textLight,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  loginButton: {
    minWidth: 200,
  },
  deleteRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  deleteText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    textDecorationLine: 'underline',
  },
});
