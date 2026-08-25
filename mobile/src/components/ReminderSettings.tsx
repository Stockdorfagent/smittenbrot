import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, Modal, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { theme } from '@/lib/theme';
import {
  ReminderPrefs,
  ReminderSlot,
  DEFAULT_REMINDER,
  DEFAULT_SLOT,
  SECOND_SLOT,
  WEEKDAY_OPTIONS,
  weekdayLabel,
  formatTime,
  loadReminderPrefs,
  applyReminders,
  makeSlot,
} from '@/lib/reminder';

function dateFromHM(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function ReminderSettings() {
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_REMINDER);
  const [ready, setReady] = useState(false);
  // Which slot a picker is currently editing (null = closed).
  const [dayFor, setDayFor] = useState<string | null>(null);
  const [timeFor, setTimeFor] = useState<string | null>(null);

  useEffect(() => {
    loadReminderPrefs().then((p) => {
      setPrefs(p);
      setReady(true);
    });
  }, []);

  // Persist + (re)schedule the local notification. Reverts the toggle if the
  // user enabled reminders but denied notification permission.
  const commit = async (next: ReminderPrefs) => {
    setPrefs(next);
    const ok = await applyReminders(next);
    if (!ok) {
      setPrefs({ ...next, enabled: false });
      await applyReminders({ ...next, enabled: false });
      Alert.alert(
        'Benachrichtigungen deaktiviert',
        'Erlaube Smittenbrot in den Einstellungen deines Geräts, dir Mitteilungen zu senden, um Erinnerungen zu erhalten.',
      );
    }
  };

  const updateSlot = (id: string, patch: Partial<ReminderSlot>) =>
    commit({ ...prefs, slots: prefs.slots.map((sl) => (sl.id === id ? { ...sl, ...patch } : sl)) });

  const addSlot = () => {
    // Offer Thursday for the second one — the other cutoff — then Monday again.
    const base = prefs.slots.length === 1 ? SECOND_SLOT : DEFAULT_SLOT;
    commit({ ...prefs, slots: [...prefs.slots, makeSlot(base)] });
  };

  const removeSlot = (id: string) =>
    commit({ ...prefs, slots: prefs.slots.filter((sl) => sl.id !== id) });

  const onTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (!timeFor) return;
    if (Platform.OS === 'android') {
      const id = timeFor;
      setTimeFor(null);
      if (event.type === 'set' && date) {
        updateSlot(id, { hour: date.getHours(), minute: date.getMinutes() });
      }
    } else if (date) {
      // iOS spinner updates live; commit happens when the user taps "Fertig".
      setPrefs({
        ...prefs,
        slots: prefs.slots.map((sl) =>
          sl.id === timeFor ? { ...sl, hour: date.getHours(), minute: date.getMinutes() } : sl,
        ),
      });
    }
  };

  if (!ready) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Erinnerung</Text>

      <View style={styles.toggleRow}>
        <View style={{ flex: 1, paddingRight: theme.spacing.md }}>
          <Text style={styles.rowLabel}>Bestell-Erinnerung</Text>
          <Text style={styles.hint}>
            Wöchentliche Erinnerung – Tag und Uhrzeit wählbar, auch mehrfach.
          </Text>
        </View>
        <Switch
          value={prefs.enabled}
          onValueChange={(v) =>
            // Turning it on with no slots yet would schedule nothing, so seed
            // the first one (Monday 09:00, before the Wednesday cutoff).
            commit({
              ...prefs,
              enabled: v,
              slots: v && prefs.slots.length === 0 ? [makeSlot(DEFAULT_SLOT)] : prefs.slots,
            })
          }
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          thumbColor={theme.colors.white}
        />
      </View>

      {prefs.enabled && (
        <>
          {prefs.slots.map((slot, i) => (
            <View key={slot.id}>
              <View style={styles.slotHeader}>
                <Text style={styles.slotTitle}>
                  {prefs.slots.length > 1 ? `Erinnerung ${i + 1}` : 'Erinnerung'}
                </Text>
                {prefs.slots.length > 1 && (
                  <TouchableOpacity onPress={() => removeSlot(slot.id)} hitSlop={8}>
                    <Text style={styles.remove}>Entfernen</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity style={styles.pickRow} onPress={() => setDayFor(slot.id)}>
                <Text style={styles.rowLabel}>Tag</Text>
                <View style={styles.pickValue}>
                  <Text style={styles.pickValueText}>{weekdayLabel(slot.weekday)}</Text>
                  <Ionicons name="chevron-down" size={18} color={theme.colors.textLight} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickRow} onPress={() => setTimeFor(slot.id)}>
                <Text style={styles.rowLabel}>Uhrzeit</Text>
                <View style={styles.pickValue}>
                  <Text style={styles.pickValueText}>{formatTime(slot.hour, slot.minute)} Uhr</Text>
                  <Ionicons name="chevron-down" size={18} color={theme.colors.textLight} />
                </View>
              </TouchableOpacity>

              {timeFor === slot.id && (
                <View>
                  <DateTimePicker
                    value={dateFromHM(slot.hour, slot.minute)}
                    mode="time"
                    is24Hour
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onTimeChange}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={styles.done}
                      onPress={() => {
                        setTimeFor(null);
                        commit(prefs);
                      }}
                    >
                      <Text style={styles.doneText}>Fertig</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}

          {/* Someone who orders single loaves may want reminding before BOTH
              cutoffs — Monday for Wednesday, Thursday for Saturday. */}
          <TouchableOpacity style={styles.addRow} onPress={addSlot}>
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.addText}>Weitere Erinnerung hinzufügen</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={!!dayFor} transparent animationType="fade" onRequestClose={() => setDayFor(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setDayFor(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Tag wählen</Text>
            {WEEKDAY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.option}
                onPress={() => {
                  const id = dayFor;
                  setDayFor(null);
                  if (id) updateSlot(id, { weekday: opt.value });
                }}
              >
                <Text style={styles.optionText}>{opt.label}</Text>
                {opt.value === prefs.slots.find((sl) => sl.id === dayFor)?.weekday && (
                  <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  rowLabel: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing.md,
    marginTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  pickValue: { flexDirection: 'row', alignItems: 'center' },
  slotHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.spacing.md,
  },
  slotTitle: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.textLight },
  remove: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs,
    paddingTop: theme.spacing.md, marginTop: theme.spacing.md,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  addText: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.primary },
  pickValueText: { fontSize: theme.fontSize.md, color: theme.colors.text, marginRight: theme.spacing.xs },
  done: { alignSelf: 'flex-end', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  doneText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  sheetTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  optionText: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
});
