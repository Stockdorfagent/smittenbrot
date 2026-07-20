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
    if (status !== 'granted') return;

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
