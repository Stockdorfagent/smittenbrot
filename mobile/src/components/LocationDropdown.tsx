import { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import type { PickupLocation } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeColors } from '@/lib/theme';

interface Props {
  locations: PickupLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LocationDropdown({ locations, selectedId, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const selected = locations.find((l) => l.id === selectedId);

  return (
    <>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(true)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{selected?.name ?? 'Abholort wählen'}</Text>
          {selected?.address ? <Text style={styles.address}>{selected.address}</Text> : null}
        </View>
        <Ionicons name="chevron-down" size={20} color={colors.textLight} />
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
                {loc.id === selectedId && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  dropdown: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: theme.spacing.md,
  },
  name: { fontSize: theme.fontSize.md, fontWeight: '600', color: colors.text },
  address: { fontSize: theme.fontSize.sm, color: colors.textLight, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl,
  },
  title: { fontSize: theme.fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: theme.spacing.md },
  option: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  optionName: { fontSize: theme.fontSize.md, fontWeight: '600', color: colors.text },
  optionAddress: { fontSize: theme.fontSize.sm, color: colors.textLight, marginTop: 2 },
});
