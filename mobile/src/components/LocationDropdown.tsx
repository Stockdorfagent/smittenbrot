import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import type { PickupLocation } from '@/lib/types';

interface Props {
  locations: PickupLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LocationDropdown({ locations, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const selected = locations.find((l) => l.id === selectedId);

  return (
    <>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(true)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{selected?.name ?? 'Abholort wählen'}</Text>
          {selected?.address ? <Text style={styles.address}>{selected.address}</Text> : null}
        </View>
        <Ionicons name="chevron-down" size={20} color={theme.colors.textLight} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Abholort wählen</Text>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                style={styles.option}
                onPress={() => { onSelect(loc.id); setOpen(false); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionName}>{loc.name}</Text>
                  <Text style={styles.optionAddress}>{loc.address}</Text>
                </View>
                {loc.id === selectedId && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  name: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  address: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl,
  },
  title: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
  option: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  optionName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  optionAddress: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
});
