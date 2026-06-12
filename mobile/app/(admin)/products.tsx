import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import type { Product, ProductCycle } from '@/lib/types';

const CYCLE_LABELS: Record<string, string> = {
  permanent: 'Immer',
  week_a: 'Woche A',
  week_b: 'Woche B',
  hidden: 'Versteckt',
};

export default function AdminProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});

  const fetchProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').order('sort_order');
    setProducts(data ?? []);
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const openEdit = (product: Product) => {
    setEditProduct(product);
    setEditForm({ ...product });
    setShowModal(true);
  };

  const openCreate = () => {
    setEditProduct(null);
    setEditForm({
      name: '', description: '', price_cents: 0, capacity: 10,
      cycle: 'permanent', available_wed: true, available_sat: true,
      active: true, sort_order: 0,
    });
    setShowModal(true);
  };

  const handleDisable = async (product: Product) => {
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['scheduled', 'processing', 'locked_for_production']);
    const openCount = count ?? 0;

    Alert.alert(
      'Produkt deaktivieren',
      product.id
        ? `Achtung: Dieses Produkt befindet sich in ${openCount} offenen Bestellungen.`
        : 'Möchtest du dieses Produkt wirklich deaktivieren?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Nur zukünftig', onPress: () => handleSave({ ...product, active: false }) },
        ...(openCount > 0 ? [{ text: 'Komplett deaktivieren & Kunden benachrichtigen', style: 'destructive' as const, onPress: () => handleSave({ ...product, active: false }) }] : []),
      ]
    );
  };

  const handleSave = async (form: Partial<Product>) => {
    const payload = { ...editForm, ...form };
    if (!editProduct) {
      const { error } = await supabase.from('products').insert(payload);
      if (error) Alert.alert('Fehler', error.message);
    } else {
      const { error } = await supabase.from('products').update(payload).eq('id', editProduct.id);
      if (error) Alert.alert('Fehler', error.message);
    }
    setShowModal(false);
    fetchProducts();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button title="Neues Produkt" onPress={openCreate} variant="accent" size="sm" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {products.map((product) => (
          <TouchableOpacity key={product.id} style={styles.productCard} onPress={() => openEdit(product)}>
            <View style={styles.productInfo}>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productMeta}>
                {CYCLE_LABELS[product.cycle]} · {(product.price_cents / 100).toFixed(2)}€ · Kapazität: {product.capacity}
              </Text>
              <View style={styles.badgeRow}>
                {!product.active && <View style={styles.badgeHidden}><Text style={styles.badgeText}>Inaktiv</Text></View>}
                {product.available_wed && <View style={styles.badgeWed}><Text style={styles.badgeText}>Mi</Text></View>}
                {product.available_sat && <View style={styles.badgeSat}><Text style={styles.badgeText}>Sa</Text></View>}
              </View>
            </View>
            <TouchableOpacity onPress={() => handleDisable(product)}>
              <Text style={styles.disableText}>Deaktivieren</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>{editProduct ? 'Produkt bearbeiten' : 'Neues Produkt'}</Text>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={editForm.name || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, name: t }))} />
              <Text style={styles.label}>Beschreibung</Text>
              <TextInput style={styles.input} value={editForm.description || ''} onChangeText={(t) => setEditForm((f) => ({ ...f, description: t }))} multiline />
              <Text style={styles.label}>Preis (Cent)</Text>
              <TextInput style={styles.input} value={String(editForm.price_cents || 0)} onChangeText={(t) => setEditForm((f) => ({ ...f, price_cents: parseInt(t) || 0 }))} keyboardType="number-pad" />
              <Text style={styles.label}>Kapazität</Text>
              <TextInput style={styles.input} value={String(editForm.capacity || 0)} onChangeText={(t) => setEditForm((f) => ({ ...f, capacity: parseInt(t) || 0 }))} keyboardType="number-pad" />
              <Text style={styles.label}>Zyklus</Text>
              <View style={styles.cycleRow}>
                {(['permanent', 'week_a', 'week_b', 'hidden'] as ProductCycle[]).map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.cycleOption, editForm.cycle === c && styles.cycleOptionActive]}
                    onPress={() => setEditForm((f) => ({ ...f, cycle: c }))}
                  >
                    <Text style={[styles.cycleText, editForm.cycle === c && styles.cycleTextActive]}>{CYCLE_LABELS[c]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.toggleRow}>
                <TouchableOpacity onPress={() => setEditForm((f) => ({ ...f, available_wed: !f.available_wed }))}>
                  <Text style={editForm.available_wed ? styles.toggleOn : styles.toggleOff}>Mittwoch</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditForm((f) => ({ ...f, available_sat: !f.available_sat }))}>
                  <Text style={editForm.available_sat ? styles.toggleOn : styles.toggleOff}>Samstag</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modalActions}>
                <Button title="Speichern" onPress={() => handleSave(editForm)} variant="primary" />
                <Button title="Abbrechen" onPress={() => setShowModal(false)} variant="ghost" />
              </View>
            </ScrollView>
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
  productCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  productInfo: { flex: 1 },
  productName: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  productMeta: { fontSize: theme.fontSize.xs, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  badgeRow: { flexDirection: 'row', gap: 4, marginTop: theme.spacing.sm },
  badgeHidden: { backgroundColor: '#FEE2E2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  badgeWed: { backgroundColor: '#DBEAFE', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  badgeSat: { backgroundColor: '#D1FAE5', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 10, fontWeight: '600', color: theme.colors.text },
  disableText: { fontSize: theme.fontSize.xs, color: theme.colors.error },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: theme.spacing.lg },
  modalContent: { backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.xl, padding: theme.spacing.lg, maxHeight: '80%' },
  modalTitle: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.lg },
  label: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xs, marginTop: theme.spacing.sm },
  input: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.md, padding: 12, fontSize: theme.fontSize.md, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  cycleRow: { flexDirection: 'row', gap: theme.spacing.sm, marginVertical: theme.spacing.sm },
  cycleOption: { paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.cream },
  cycleOptionActive: { backgroundColor: theme.colors.primary },
  cycleText: { fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.textLight },
  cycleTextActive: { color: theme.colors.white },
  toggleRow: { flexDirection: 'row', gap: theme.spacing.md, marginVertical: theme.spacing.md },
  toggleOn: { backgroundColor: theme.colors.primary, color: theme.colors.white, paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.borderRadius.md, fontWeight: '600', overflow: 'hidden' },
  toggleOff: { backgroundColor: theme.colors.cream, color: theme.colors.textLight, paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.borderRadius.md, fontWeight: '600', overflow: 'hidden' },
  modalActions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.lg },
});
