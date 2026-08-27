import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, AppState, Linking, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/lib/theme';
import { hasNotificationPermission } from '@/lib/push';

/**
 * Tells the customer, in the one place they would look, that this phone is not
 * receiving app notifications.
 *
 * Why it exists: notifications now go to the app first and only fall back to
 * email when the push fails. Someone who declined the permission prompt — or
 * turned notifications off months later — could otherwise sit in front of a
 * silent app wondering why nothing arrives, or worse, not wonder at all and
 * miss that their bread is waiting in the cabinet.
 *
 * The tone is deliberately informative rather than alarming: with the
 * permission withdrawn the app clears its push token, so those messages really
 * do arrive by email. Nothing is lost — it is only worth knowing which inbox to
 * watch.
 *
 * When notifications ARE working it drops to a single quiet sentence rather
 * than a box — no chrome, no icon. That one line is worth keeping, because the
 * app now suppresses the email whenever it can reach the phone: without it,
 * someone who used to get order reminders by email would just notice they had
 * stopped and assume something was broken.
 */
export function NotificationStatusCard() {
  const [granted, setGranted] = useState<boolean | null>(null);

  const check = useCallback(() => {
    let alive = true;
    hasNotificationPermission().then((ok) => {
      if (alive) setGranted(ok);
    });
    // Permission is changed in the system settings, i.e. outside the app, so
    // the answer can only change while we are in the background.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        hasNotificationPermission().then((ok) => {
          if (alive) setGranted(ok);
        });
      }
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useFocusEffect(check);

  // null = not checked yet. Never flash either state before we know.
  if (granted === null) return null;

  if (granted) {
    return (
      <Text style={styles.fine}>
        Solange du die App nutzt, bekommst du alles direkt hier. E-Mails schicken wir dir nur,
        wenn wir dich in der App nicht erreichen — deine Bestellbestätigung kommt immer per E-Mail.
      </Text>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="notifications-off-outline" size={18} color={theme.colors.primary} />
        <Text style={styles.title}>Mitteilungen sind ausgeschaltet</Text>
      </View>
      <Text style={styles.body}>
        Du bekommst deine Erinnerungen und die Nachricht, dass dein Brot abholbereit ist,
        deshalb per E-Mail. In der App siehst du auf der Startseite ebenfalls, sobald deine
        Bestellung bereitliegt.
      </Text>
      <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
        <Text style={styles.action}>Mitteilungen in den Einstellungen aktivieren ›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fine: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    lineHeight: 17,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    // A left rule in brand red instead of a tinted fill — the palette allows
    // red, white, black and greys, and no red washes.
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  title: { fontSize: theme.fontSize.md, fontWeight: '700', color: theme.colors.text },
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
  action: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary,
    marginTop: theme.spacing.md,
  },
});
