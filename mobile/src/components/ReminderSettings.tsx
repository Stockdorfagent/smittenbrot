import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, Modal, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { theme } from '@/lib/theme';
import {
  ReminderPrefs,
  DEFAULT_REMINDER,
  WEEKDAY_OPTIONS,
  weekdayLabel,
  formatTime,
  loadReminderPrefs,
  applyReminder,
} from '@/lib/reminder';

function dateFromHM(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function ReminderSettings() {
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_REMINDER);
  const [ready, setReady] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [showTime, setShowTime] = useState(false);

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
    const ok = await applyReminder(next);
    if (!ok) {
      setPrefs({ ...next, enabled: false });
      await applyReminder({ ...next, enabled: false });
      Alert.alert(
        'Benachrichtigungen deaktiviert',
        'Erlaube Smittenbrot in den Einstellungen deines Geräts, dir Mitteilungen zu senden, um Erinnerungen zu erhalten.',
      );
    }
  };

  const onTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowTime(false);
      if (event.type === 'set' && date) {
        commit({ ...prefs, hour: date.getHours(), minute: date.getMinutes() });
      }
    } else if (date) {
      // iOS spinner updates live; commit happens when the user taps "Fertig".
      setPrefs({ ...prefs, hour: date.getHours(), minute: date.getMinutes() });
    }
  };

  if (!ready) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Erinnerung</Text>

      <View style={styles.toggleRow}>
        <View style={{ flex: 1, paddingRight: theme.spacing.md }}>
          <Text style={styles.rowLabel}>Bestell-Erinnerung</Text>
          <Text style={styles.hint}>Wöchentliche Push-Benachrichtigung – Tag und Uhrzeit wählbar.</Text>
        </View>
        <Switch
          value={prefs.enabled}
          onValueChange={(v) => commit({ ...prefs, enabled: v })}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          thumbColor={theme.colors.white}
        />
      </View>

      {prefs.enabled && (
        <>
          <TouchableOpacity style={styles.pickRow} onPress={() => setDayOpen(true)}>
            <Text style={styles.rowLabel}>Tag</Text>
            <View style={styles.pickValue}>
              <Text style={styles.pickValueText}>{weekdayLabel(prefs.weekday)}</Text>
              <Ionicons name="chevron-down" size={18} color={theme.colors.textLight} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.pickRow} onPress={() => setShowTime(true)}>
            <Text style={styles.rowLabel}>Uhrzeit</Text>
            <View style={styles.pickValue}>
              <Text style={styles.pickValueText}>{formatTime(prefs.hour, prefs.minute)} Uhr</Text>
              <Ionicons name="chevron-down" size={18} color={theme.colors.textLight} />
            </View>
          </TouchableOpacity>

          {showTime && (
            <View>
              <DateTimePicker
                value={dateFromHM(prefs.hour, prefs.minute)}
                mode="time"
                is24Hour
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onTimeChange}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.done}
                  onPress={() => {
                    setShowTime(false);
                    commit(prefs);
                  }}
                >
                  <Text style={styles.doneText}>Fertig</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      )}

      <Modal visible={dayOpen} transparent animationType="fade" onRequestClose={() => setDayOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setDayOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Tag wählen</Text>
            {WEEKDAY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.option}
                onPress={() => {
                  setDayOpen(false);
                  commit({ ...prefs, weekday: opt.value });
                }}
              >
                <Text style={styles.optionText}>{opt.label}</Text>
                {opt.value === prefs.weekday && (
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
