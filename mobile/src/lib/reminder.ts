import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reminderDates } from './reminderDates';
import type { ClosureRange } from './pickup';

/**
 * Personal order reminders — repeating weekly LOCAL notifications scheduled on
 * the device itself. They need no push token and no APNs key, so they work on
 * iOS as well as Android and even offline. Nothing is sent from the server.
 *
 * There can be several: a tester pointed out that someone who orders single
 * loaves rather than running a subscription may want reminding before BOTH
 * cut-offs — Monday for the Wednesday pickup and Thursday for the Saturday one.
 * (Subscribers already get an automatic reminder at midday on ordering days,
 * so this is mainly for everyone else.)
 *
 * Since 22.11.2026 they are not one repeating weekly trigger but single dated
 * notifications for the next REMINDER_WEEKS weeks (lib/reminderDates.ts), so a
 * Schließzeit is left out instead of reminding people to order for a day
 * nobody bakes. ClosureContext reschedules them every time it reads the
 * closures (app start, start-screen focus).
 */

const STORAGE_KEY = 'orderReminderPrefs';
const REMINDER_PREFIX = 'weekly-order-reminder';
const ANDROID_CHANNEL = 'reminders';

export interface ReminderSlot {
  /** Stable per-slot id, used to build the notification identifier. */
  id: string;
  weekday: number; // 1 = Sunday … 7 = Saturday (expo/Apple convention)
  hour: number; // 0–23
  minute: number; // 0–59
}

export interface ReminderPrefs {
  enabled: boolean;
  slots: ReminderSlot[];
}

/** Monday 09:00 — comfortably before the Monday 22:00 cutoff. */
export const DEFAULT_SLOT: Omit<ReminderSlot, 'id'> = { weekday: 2, hour: 9, minute: 0 };

/** Thursday 09:00 — the natural second one, before the Saturday cutoff. */
export const SECOND_SLOT: Omit<ReminderSlot, 'id'> = { weekday: 5, hour: 9, minute: 0 };

export const DEFAULT_REMINDER: ReminderPrefs = { enabled: false, slots: [] };

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

export function newSlotId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function makeSlot(base: Omit<ReminderSlot, 'id'> = DEFAULT_SLOT): ReminderSlot {
  return { id: newSlotId(), ...base };
}

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REMINDER;
    const parsed = JSON.parse(raw);

    // Migrate the original single-reminder shape
    // ({ enabled, weekday, hour, minute }) into one slot.
    if (parsed && !Array.isArray(parsed.slots)) {
      return {
        enabled: !!parsed.enabled,
        slots: [{
          id: newSlotId(),
          weekday: parsed.weekday ?? DEFAULT_SLOT.weekday,
          hour: parsed.hour ?? DEFAULT_SLOT.hour,
          minute: parsed.minute ?? DEFAULT_SLOT.minute,
        }],
      };
    }
    return { enabled: !!parsed.enabled, slots: parsed.slots ?? [] };
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

/** Clear every reminder we have ever scheduled, whatever the slot ids were. */
async function cancelAll(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => (n.identifier ?? '').startsWith(REMINDER_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
  } catch {
    // ignore — worst case a stale reminder survives until the next apply
  }
}

/**
 * Persist the preferences and (re)schedule every reminder as dated
 * notifications for the coming weeks, skipping closed pickup days.
 * Returns false only when the user enabled them but denied notification
 * permission, so the caller can revert the toggle. With `prompt: false`
 * (background reschedule) the permission is never requested, only checked.
 */
export async function applyReminders(
  prefs: ReminderPrefs,
  closures: readonly ClosureRange[] = [],
  opts: { prompt?: boolean } = {},
): Promise<boolean> {
  await persist(prefs);
  await cancelAll();

  if (!prefs.enabled || prefs.slots.length === 0) return true;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted' && opts.prompt !== false) {
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

  for (const slot of prefs.slots) {
    for (const at of reminderDates(slot, closures)) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${REMINDER_PREFIX}-${slot.id}-${at.getTime()}`,
        content: {
          title: 'Smittenbrot',
          body: 'Vergiss nicht, dein Brot zu bestellen!',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: ANDROID_CHANNEL,
        },
      });
    }
  }
  return true;
}

/**
 * Re-plan the saved reminders against the current closures (called by
 * ClosureContext after every read). Never prompts for permission; a user
 * who has reminders off or no permission is left alone.
 */
export async function rescheduleReminders(closures: readonly ClosureRange[]): Promise<void> {
  try {
    const prefs = await loadReminderPrefs();
    if (!prefs.enabled || prefs.slots.length === 0) return;
    await applyReminders(prefs, closures, { prompt: false });
  } catch {
    // best effort — the next read tries again
  }
}
