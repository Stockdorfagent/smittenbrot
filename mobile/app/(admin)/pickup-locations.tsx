import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { PickupLocation } from '@/lib/types';

export default function AdminPickupLocationsScreen() {
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<PickupLocation>>({});
  const [editId, setEditId] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    const { data } = await supabase.from('pickup_locations').select('*').order('sort_order');
    setLocations(data ?? []);
  }, []);

  useEffect(() => { fetchLocations(); }, [fetchLocations]);

  const openEdit = (loc: PickupLocation) => {
    setEditId(loc.id);
    setEditForm({ ...loc });
    setShowModal(true);
  };

  const openCreate = () => {
    setEditId(null);
    setEditForm({ name: '', address: '', notification_template: '', active: true, sort_order: 0 });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!editForm.name || !editForm.address) {
      Alert.alert('Fehler', 'Name und Adresse sind erforderlich');
      return;
    }
    if (editId) {
      const { error } = await supabase.from('pickup_locations').update(editForm).eq('id', editId);
      if (error) Alert.alert('Fehler', error.message);
    } else {
      const { error } = await supabase.from('pickup_locations').insert(editForm);
      if (error) Alert.alert('Fehler', error.message);
    }
    setShowModal(false);
    fetchLocations();
  };

  const toggleActive = async (loc: PickupLocation) => {
    const { error } = await supabase.from('pickup_locations').update({ active: !loc.active }).eq('id', loc.id);
    if (error) Alert.alert('Fehler', error.message);
    else fetchLocations();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button title="Neuer Abholort" onPress={openCreate} variant="accent" size="sm" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {locations.map((loc) => (
          <TouchableOpacity key={loc.id} style={styles.card} onPress={() => openEdit(loc)}>
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{loc.name}</Text>
                <Text style={styles.address}>{loc.address}</Text>
              </View>
              <TouchableOpacity onPress={() => toggleActive(loc)}>
                <Text style={loc.active ? styles.activeText : styles.inactiveText}>
                  {loc.active ? 'Aktiv' : 'Inaktiv'}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editId ? 'Bearbeiten' : 'Neuer Abholort'}</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={editForm.name || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, name: t }))} />
            <Text style={styles.label}>Adresse</Text>
            <TextInput style={styles.input} value={editForm.address || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, address: t }))} />
            <Text style={styles.label}>Benachrichtigungsvorlage</Text>
            <Text style={styles.hint}>Platzhalter: {`{ORDER_NUMBER}`, `{PICKUP_LOCATION}`, `{EXTRA_TEXT}`}</Text>
            <TextInput style={[styles.input, { minHeight: 80 }]} value={editForm.notification_template || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, notification_template: t }))} multiline />
            <TouchableOpacity onPress={() => setEditForm((f) => ({ ...f, active: !f.active }))}>
              <Text style={editForm.active ? styles.toggleOn : styles.toggleOff}>
                {editForm.active ? 'Aktiv' : 'Inaktiv'}
              </Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <Button title="Speichern" onPress={handleSave} variant="primary" />
              <Button title="Abbrechen" onPress={() => setShowModal(false)} variant="ghost" />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: theme.spacing.md, flexDirection: 'row', justifyContent: 'flex-end' },
  scroll: { padding: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  address: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  activeText: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.success },
  inactiveText: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: theme.spacing.lg },
  modalContent: { backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.xl, padding: theme.spacing.lg, maxHeight: '80%' },
  modalTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.lg },
  label: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs, marginTop: theme.spacing.sm },
  hint: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, fontStyle: 'italic', marginBottom: theme.spacing.xs },
  input: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.md, padding: 12, fontSize: theme.fontSize.md, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  toggleOn: { backgroundColor: theme.colors.success, color: theme.colors.white, paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.borderRadius.md, fontWeight: '600', overflow: 'hidden', marginTop: theme.spacing.md, alignSelf: 'flex-start' },
  toggleOff: { backgroundColor: theme.colors.cream, color: theme.colors.textLight, paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.borderRadius.md, fontWeight: '600', overflow: 'hidden', marginTop: theme.spacing.md, alignSelf: 'flex-start' },
  modalActions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.lg },
});
