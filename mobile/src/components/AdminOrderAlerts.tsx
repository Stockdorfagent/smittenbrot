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

      // Listen to INSERT *and* UPDATE. An order is never inserted as paid:
      // stripe-webhook inserts it as 'pending' and then updates it to 'paid'
      // so the numbering trigger fires. Watching INSERT alone therefore never
      // saw a paid order and the ka-ching never rang, even in the foreground.
      const alreadySeen = new Set<string>();

      channel = supabase
        .channel('admin-order-alerts')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders' },
          (payload) => {
            if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
            const row = payload.new as {
              id?: string;
              payment_status?: string;
              order_number?: string;
              total_cents?: number;
            };
            // "Money in" = a paid order. Ignore un-charged/pending rows.
            if (row?.payment_status !== 'paid') return;
            // An order can be updated more than once after payment (status
            // changes, fulfilment) — ring once per order.
            if (row.id) {
              if (alreadySeen.has(row.id)) return;
              alreadySeen.add(row.id);
            }

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
