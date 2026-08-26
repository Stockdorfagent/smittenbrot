import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// Show notifications while the app is in the foreground too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Android 8.0+ ignores a per-notification sound: it comes from the channel.
 * So the ka-ching needs its own channel, created before any push arrives.
 * iOS takes the sound straight from the payload and needs no channel.
 */
export const KACHING_CHANNEL = 'orders';

export async function ensureOrderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(KACHING_CHANNEL, {
      name: 'Bestellungen',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'kaching.wav',
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
    // best effort — a missing channel only costs the custom sound
  }
}

/**
 * Clear the icon badge (and the notification shade) when the app is opened.
 *
 * Nothing did this, so the launcher kept showing "2" long after the app had
 * been opened — implying unread content that does not exist, since the app has
 * no notification inbox. `shouldSetBadge: false` above only covers
 * notifications arriving while the app is in the foreground; it says nothing
 * about ones delivered while it was closed. On Android the launcher count comes
 * from the notifications still in the shade, which is why the badge has to be
 * dismissed there rather than merely zeroed.
 *
 * Best-effort: badge APIs are unsupported on some launchers and on web.
 */
export async function clearNotificationBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // unsupported launcher — ignore
  }
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // ignore
  }
}

/**
 * Has this device actually got permission to show notifications?
 *
 * Not the same question as "did we ever ask": permission can be withdrawn in
 * the system settings long after it was granted.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Forget this customer's push token on the server.
 *
 * The backend now treats a stored token as "this person can be reached in the
 * app" and skips the email when a push goes out. A token that outlives the
 * permission breaks that promise silently: Expo accepts the push, the phone
 * shows nothing, and no email is sent either — so the customer never learns
 * their bread is ready. Clearing it puts them back on email, which is the
 * right channel for someone with notifications switched off.
 */
async function clearStoredPushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('customers')
      .update({ push_token: null })
      .eq('id', userId)
      .not('push_token', 'is', null); // no pointless write when already clear
  } catch (err) {
    console.warn('[push] could not clear stale token:', err);
  }
}

/**
 * Re-check permission and bring the stored token in line with it. Unlike
 * registerAndSavePushToken this NEVER prompts, so it is safe to run every time
 * the app comes to the foreground — which is when a permission change made in
 * the system settings becomes visible to us.
 */
export async function syncPushRegistration(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;
    if (await hasNotificationPermission()) {
      // Permission may have been granted in settings after we last asked.
      await registerAndSavePushToken(userId);
    } else {
      await clearStoredPushToken(userId);
    }
  } catch (err) {
    console.warn('[push] sync failed:', err);
  }
}

/**
 * Request notification permission, obtain the Expo push token, and save it
 * to the customer's `push_token` so the backend (subscription engine /
 * notification dispatch) can reach this device. Safe to call repeatedly.
 *
 * No-ops on simulators/web (push requires a physical device) and when the
 * user denies permission — never throws.
 */
export async function registerAndSavePushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') {
      // Permission refused (or withdrawn since last time). Drop any token we
      // stored earlier — see clearStoredPushToken for why that matters.
      await clearStoredPushToken(userId);
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Standard',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) return;

    await supabase.from('customers').update({ push_token: token }).eq('id', userId);
  } catch (err) {
    // Push is best-effort — never block the app on it.
    console.warn('[push] registration failed:', err);
  }
}
