import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Personal order reminder — a repeating weekly LOCAL notification scheduled
 * on the device itself. It needs no push token and no APNs key, so it works
 * on iOS as well as Android and even offline. The customer picks the weekday
 * and time in Profil; nothing is sent from the server.
 */

const STORAGE_KEY = 'orderReminderPrefs';
const REMINDER_ID = 'weekly-order-reminder';
const ANDROID_CHANNEL = 'reminders';

export interface ReminderPrefs {
  enabled: boolean;
  weekday: number; // 1 = Sunday … 7 = Saturday (expo/Apple convention)
  hour: number; // 0–23
  minute: number; // 0–59
}

export const DEFAULT_REMINDER: ReminderPrefs = {
  enabled: false,
  weekday: 2, // Montag — before the Monday 22:00 cutoff for Wednesday pickup
  hour: 9,
  minute: 0,
};

// Ordered Mon→Sun for the picker (business week starts Monday).
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 2, label: 'Montag' },
  { value: 3, label: 'Dienstag' },
  { value: 4, label: 'Mittwoch' },
  { value: 5, label: 'Donnerstag' },
  { value: 6, label: 'Freitag' },
  { value: 7, label: 'Samstag' },
  { value: 1, label: 'Sonntag' },
];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_OPTIONS.find((w) => w.value === weekday)?.label ?? '';
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REMINDER;
    return { ...DEFAULT_REMINDER, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_REMINDER;
  }
}

async function persist(prefs: ReminderPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort — a failed persist is not worth blocking the UI.
  }
}

/**
 * Persist the preference and (re)schedule the on-device reminder.
 * Returns false only when the user enabled it but denied notification
 * permission, so the caller can revert the toggle.
 */
export async function applyReminder(prefs: ReminderPrefs): Promise<boolean> {
  await persist(prefs);

  // Always clear the previous schedule first, then re-create if enabled.
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});

  if (!prefs.enabled) return true;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Erinnerungen',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'Smittenbrot',
      body: 'Vergiss nicht, dein Brot zu bestellen!',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: prefs.weekday,
      hour: prefs.hour,
      minute: prefs.minute,
      channelId: ANDROID_CHANNEL,
    },
  });
  return true;
}
