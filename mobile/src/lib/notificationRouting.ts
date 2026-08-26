import { useEffect, useRef } from 'react';
import { useRouter, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';

/**
 * Open the screen a notification is about when it is tapped.
 *
 * Every notification used to land on the start page, whatever it said — a
 * tester reported that being told "deine Bestellung ist abholbereit" and then
 * having to go and find the order yourself felt unfinished. The server now
 * attaches a `type` (and an id where one exists) to every push, and this maps
 * that onto a route.
 *
 * Two things make this fiddlier than it looks:
 *
 *  - A tap can arrive before there is anything to navigate with. Launching the
 *    app from a cold start via a notification means the router is still
 *    mounting, and pushing a route then does nothing at all. Hence the wait on
 *    `useRootNavigationState()`.
 *  - `useLastNotificationResponse()` keeps returning the same response on every
 *    re-render for the rest of the session, so without the seen-guard the app
 *    would yank the user back to that screen every time anything re-rendered.
 */

type PushData = {
  type?: string;
  order_id?: string;
  subscription_id?: string;
};

/** Where a notification of this kind belongs. */
export function routeForNotification(data: PushData): string | null {
  switch (data.type) {
    case 'pickup_ready':
    case 'order_placed':
    case 'order_receipt':
      // The order itself: what is in it, where to collect it, its number.
      return data.order_id ? `/order/${data.order_id}` : '/(tabs)/orders';

    case 'subscription_reminder':
    case 'subscription_cancelled':
    case 'payment_failed':
      // All three are about the subscription: change it before the cutoff,
      // restart it, or fix the card.
      return '/(tabs)/subscriptions';

    case 'admin_alert':
      // Only ever sent to admins; a new order means the bake list changed.
      return '/admin-bakeday';

    default:
      // Includes the personal weekly reminder, which is a nudge to order —
      // and ordering is what the start page is for. Returning null leaves the
      // app wherever it opened, which for a cold start is the start page.
      return null;
  }
}

/**
 * @param signedIn Orders and subscriptions are behind the login, so hold the
 *   tap until the session has been restored rather than dropping someone on an
 *   empty screen. The response object survives re-renders, so the effect simply
 *   runs again once this flips.
 */
export function useNotificationRouting(signedIn: boolean): void {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    // Router not ready yet (cold start from a notification): this effect runs
    // again once it is, with the same response still in hand.
    if (!navigationState?.key) return;
    if (!signedIn) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;

    const data = (response.notification.request.content.data ?? {}) as PushData;
    const route = routeForNotification(data);
    handled.current = id;
    if (route) router.push(route as never);
  }, [response, navigationState?.key, signedIn, router]);
}
