import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * Admin-only, renders nothing. While an admin is logged in and the app is
 * open, it listens on Supabase Realtime for new PAID orders and plays a
 * "ka-ching" cash-register sound + a local notification the moment one lands.
 *
 * Works in the foreground (and briefly backgrounded). Alerting a fully-closed
 * app needs remote push (FCM/APNs), which is still deferred.
 */
export function AdminOrderAlerts() {
  const { user } = useAuth();
  const player = useAudioPlayer(require('../../assets/kaching.wav'));

  useEffect(() => {
    if (!user?.is_admin) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    (async () => {
      // Play even if the phone is on silent — it's a counter alert.
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
      } catch {
        // non-fatal
      }
      // Authenticate the realtime socket so RLS lets the admin receive rows.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      if (!active) return;

      channel = supabase
        .channel('admin-order-alerts')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          (payload) => {
            const row = payload.new as {
              payment_status?: string;
              order_number?: string;
              total_cents?: number;
            };
            // "Money in" = a paid order. Ignore un-charged/pending inserts.
            if (row?.payment_status !== 'paid') return;

            try {
              player.seekTo(0);
              player.play();
            } catch {
              // audio is best-effort
            }

            const eur =
              row.total_cents != null
                ? ` · ${(row.total_cents / 100).toFixed(2).replace('.', ',')} €`
                : '';
            Notifications.scheduleNotificationAsync({
              content: {
                title: 'Neue Bestellung',
                body: `Bestellung ${row.order_number ?? ''}${eur}`,
              },
              trigger: null,
            }).catch(() => {});
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.is_admin]);

  return null;
}
