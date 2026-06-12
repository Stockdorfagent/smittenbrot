import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { Closure } from '@/lib/types';

export default function AdminClosuresScreen() {
  const [closures, setClosures] = useState<Closure[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Closure>>({});

  const fetchClosures = useCallback(async () => {
    const { data } = await supabase.from('closures').select('*').order('start_date', { ascending: false });
    setClosures(data ?? []);
  }, []);

  useEffect(() => { fetchClosures(); }, [fetchClosures]);

  const handleCreate = async () => {
    if (!editForm.start_date || !editForm.end_date) {
      Alert.alert('Fehler', 'Start- und Enddatum erforderlich');
      return;
    }
    const { error } = await supabase.from('closures').insert({
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      reason: editForm.reason || '',
      banner_text_de: editForm.banner_text_de || 'Während unseres Urlaubs findet keine Produktion statt.',
    });
    if (error) Alert.alert('Fehler', error.message);
    else {
      setShowModal(false);
      fetchClosures();
    }
  };

  const handleDelete = async (closure: Closure) => {
    Alert.alert('Schließung löschen', 'Diese Schließung wird entfernt. Betroffene Abonnements werden fortgesetzt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('closures').delete().eq('id', closure.id);
          if (error) Alert.alert('Fehler', error.message);
          else fetchClosures();
        },
      },
    ]);
  };

  const now = new Date().toISOString().split('T')[0];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button title="Schließung anlegen" onPress={() => { setEditForm({}); setShowModal(true); }} variant="accent" size="sm" />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchClosures(); setRefreshing(false); }} />}
      >
        {closures.length === 0 ? (
          <Text style={styles.empty}>Keine Schließungen</Text>
        ) : (
          closures.map((closure) => {
            const isActive = closure.start_date <= now && closure.end_date >= now;
            return (
              <TouchableOpacity
                key={closure.id}
                style={[styles.card, isActive && styles.cardActive]}
                onLongPress={() => handleDelete(closure)}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.dateRange, isActive && styles.dateRangeActive]}>
                    {new Date(closure.start_date).toLocaleDateString('de-DE')} – {new Date(closure.end_date).toLocaleDateString('de-DE')}
                  </Text>
                  {isActive && <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Aktiv</Text></View>}
                </View>
                <Text style={styles.reason}>{closure.reason}</Text>
                <Text style={styles.banner}>{closure.banner_text_de}</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Schließung anlegen</Text>
            <Text style={styles.label}>Startdatum (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={editForm.start_date || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, start_date: t }))} placeholder="2025-12-24" />
            <Text style={styles.label}>Enddatum (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={editForm.end_date || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, end_date: t }))} placeholder="2026-01-06" />
            <Text style={styles.label}>Grund</Text>
            <TextInput style={styles.input} value={editForm.reason || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, reason: t }))} />
            <Text style={styles.label}>Banner-Text (DE)</Text>
            <TextInput style={[styles.input, { minHeight: 60 }]} value={editForm.banner_text_de || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, banner_text_de: t }))} multiline />
            <View style={styles.modalActions}>
              <Button title="Anlegen" onPress={handleCreate} variant="primary" />
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
  empty: { fontSize: theme.fontSize.md, color: theme.colors.textLight, textAlign: 'center', marginTop: 40 },
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.border,
  },
  cardActive: { borderLeftColor: theme.colors.accent, backgroundColor: theme.colors.cream },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm },
  dateRange: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  dateRangeActive: { color: theme.colors.primary },
  activeBadge: { backgroundColor: theme.colors.accent, borderRadius: theme.borderRadius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  activeBadgeText: { fontSize: 10, fontWeight: '700', color: theme.colors.white },
  reason: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  banner: { fontSize: theme.fontSize.sm, color: theme.colors.text, marginTop: theme.spacing.xs, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: theme.spacing.lg },
  modalContent: { backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.xl, padding: theme.spacing.lg },
  modalTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.lg },
  label: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs, marginTop: theme.spacing.sm },
  input: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.md, padding: 12, fontSize: theme.fontSize.md, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  modalActions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.lg },
});
