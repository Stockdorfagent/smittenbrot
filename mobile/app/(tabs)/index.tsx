import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { getNextPickup } from '@/lib/pickup';
import { isReadyForPickup } from '@/lib/orderStatus';
import { Button } from '@/components/Button';
import { ClosureBanner } from '@/components/ClosureBanner';
import { ProductCard } from '@/components/ProductCard';
import { ProductDetailModal } from '@/components/ProductDetailModal';
import type { Product, Subscription, Order, WeekCycle } from '@/lib/types';
import { SUBSCRIPTION_STATUS_LABELS } from '@/lib/types';

/**
 * Which subscription states earn a notice row on the pickup card, most urgent
 * first — the first entry renders first.
 */
const NOTICE_ORDER: Subscription['status'][] = ['payment_failed', 'paused'];

/** "Mittwoch, 26. August" */
function pickupLabel(order: { fulfillment_date: string }): string {
  return new Date(order.fulfillment_date + 'T12:00:00').toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { items: cartItems, addItem, updateQuantity, itemCount, totalCents } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [soldOut, setSoldOut] = useState<Record<string, boolean>>({});
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [showAllPickups, setShowAllPickups] = useState(false);

  const pickup = useMemo(() => getNextPickup(), []);

  /**
   * One card, one line per upcoming pickup.
   *
   * Two cards ("Aktives Abonnement" and "Nächste Abholung") were only ever
   * right for the simplest account. Anyone with two subscriptions saw just the
   * newest, and anyone with two pickups on the same day saw whichever the
   * database happened to return first — silently losing the other. Listing the
   * pickups themselves removes both problems and reads as one thing.
   *
   * Kept deliberately short: at most two lines, the rest behind "weitere". The
   * products are what people came for, and this card must not push them down
   * the screen.
   */
  const VISIBLE_PICKUPS = 2;
  const visiblePickups = showAllPickups ? upcomingOrders : upcomingOrders.slice(0, VISIBLE_PICKUPS);
  const hiddenPickupCount = upcomingOrders.length - visiblePickups.length;

  /**
   * Only a PAUSED or a PAYMENT_FAILED subscription earns a line of its own.
   *
   * An active Abo with no upcoming order is not a problem to report: the order
   * simply has not been generated yet, or nothing in the basket is baked this
   * week (the A/B cycle). Saying "noch keine Bestellung geplant" there would
   * invent a worry — this card is about pickups, and there is no pickup.
   *
   * A pause is different. It is a state the customer chose, it explains why no
   * bread is coming, and it is the one they may want to undo. Pausing deletes
   * the not-yet-charged order, so without this the Abo would disappear from
   * this screen entirely for the length of the pause.
   *
   * A failed charge is the most urgent of the three, so it is listed first: the
   * bread has stopped and only the customer can restart it. The declined order
   * is deliberately filtered out of the query below, so without this row a
   * payment failure would leave no trace on this screen at all.
   */
  const withUpcomingOrder = new Set(upcomingOrders.map((o) => o.subscription_id));
  const subNotices = subscriptions
    .filter((s) => NOTICE_ORDER.includes(s.status) && !withUpcomingOrder.has(s.id))
    .sort((a, b) => NOTICE_ORDER.indexOf(a.status) - NOTICE_ORDER.indexOf(b.status));

  // The pickup card also appears with no pickups at all — a paused or unpaid
  // Abo on its own — so "Abholungen" would name something that is not there.
  const pickupCardTitle =
    upcomingOrders.length > 1 ? 'Deine nächsten Abholungen'
    : upcomingOrders.length === 1 ? 'Nächste Abholung'
    : subNotices.length === 1 ? 'Dein Abonnement'
    : 'Deine Abonnements';

  const fetchData = useCallback(async () => {
    const { data: cycle } = await supabase.from('week_cycle').select('*').maybeSingle<WeekCycle>();

    const { data: allProducts } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    const filtered = (allProducts ?? []).filter((p) => {
      if (p.cycle === 'hidden') return false;
      if (pickup.day === 'wednesday' && !p.available_wed) return false;
      if (pickup.day === 'saturday' && !p.available_sat) return false;
      if (p.cycle === 'week_a' && cycle?.current_week !== 'A') return false;
      if (p.cycle === 'week_b' && cycle?.current_week !== 'B') return false;
      return true;
    });
    setProducts(filtered);

    // Real availability per product for the upcoming pickup date.
    const entries = await Promise.all(
      filtered.map(async (p) => {
        try {
          const { data } = await supabase.functions.invoke('capacity-manager/check-capacity', {
            body: { product_id: p.id, fulfillment_date: pickup.date },
          });
          const available = typeof data?.available_count === 'number' ? data.available_count : 1;
          return [p.id, available <= 0] as const;
        } catch {
          return [p.id, false] as const;
        }
      }),
    );
    setSoldOut(Object.fromEntries(entries));

    if (user) {
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('customer_id', user.id)
        .in('status', ['active', 'paused', 'payment_failed'])
        .order('created_at', { ascending: false });
      setSubscriptions((subs ?? []) as Subscription[]);

      // Only pickups that are still upcoming (today or later). Without this,
      // a paid order that was never marked fulfilled keeps showing as the
      // "next pickup" even after its pickup date has passed. Device clock =
      // Berlin (Germany-only); format manually — no Intl (Hermes).
      const now = new Date();
      const todayStr =
        `${now.getFullYear()}-` +
        `${String(now.getMonth() + 1).padStart(2, '0')}-` +
        `${String(now.getDate()).padStart(2, '0')}`;
      const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', user.id)
        // Subscription orders are pending until the 22:00 charge, but they are
        // still a pickup the customer is expecting — so include them while they
        // are PENDING. A declined charge is cancelled by the engine at the
        // source (status='cancelled', payment_status='failed'), so the status
        // filter below already hides it; this payment filter is the belt to
        // that suspender — a failed order must never read as a promised
        // pickup. The subscription is 'payment_failed' by then and gets its
        // own notice row instead. Unpaid ONE-TIME orders are abandoned
        // checkouts and stay hidden.
        .or('payment_status.eq.paid,and(order_type.eq.subscription,payment_status.eq.pending)')
        // Not a status whitelist: the admin "Abholbereit melden" button also
        // marks the order fulfilled, so whitelisting would hide the order at
        // the very moment the customer most needs to see it. Exclude the states
        // that really are over instead — plus orders ticked off WITHOUT ever
        // being announced (collected, or handled before pickup_ready_at
        // existed), which would otherwise resurface as the next pickup.
        .not('status', 'in', '("cancelled","refunded")')
        .or('status.neq.fulfilled,pickup_ready_at.not.is.null')
        .gte('fulfillment_date', todayStr)
        .order('fulfillment_date', { ascending: true });
      setUpcomingOrders((orders ?? []) as Order[]);
    } else {
      // Signed out. Without this the previous account's pickup dates and order
      // numbers stay on screen — `fetchData` re-runs when `user` becomes null,
      // skips the block above and leaves the old lists mounted.
      setSubscriptions([]);
      setUpcomingOrders([]);
      setShowAllPickups(false);
    }
  }, [user, pickup.day, pickup.date]);

  // Refetch every time the tab regains focus (e.g. after placing/cancelling
  // an order elsewhere), not just on first mount.
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  /** How many of this product are in the basket right now. */
  const cartQuantity = (productId: string) =>
    cartItems.find((i) => i.product_id === productId)?.quantity ?? 0;

  /**
   * One more of this product, straight into the basket.
   *
   * The large-order check now fires on the way past ten rather than when a
   * separate "add" button was pressed, because there is no such button any
   * more. It asks once, at the crossing, not on every tap after it.
   */
  const handleIncrease = (product: Product) => {
    if (soldOut[product.id]) return;
    const next = cartQuantity(product.id) + 1;
    const add = () =>
      addItem({
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        unit_price_cents: product.price_cents,
      });
    if (next === 11) {
      Alert.alert(
        'Menge bestätigen',
        `Du hast dann ${next}× ${product.name} im Warenkorb. Ist das korrekt?`,
        [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Ja', onPress: add }],
      );
      return;
    }
    add();
  };

  const handleDecrease = (product: Product) =>
    updateQuantity(product.id, Math.max(0, cartQuantity(product.id) - 1));

  /** Used by the product detail sheet, which has its own single add button. */
  const handleAddToCart = (product: Product) => handleIncrease(product);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ClosureBanner />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.brandHeader}>
          <Image source={require('../../assets/logo-mark.png')} style={styles.logo} />
          <Text style={styles.brand}>Smittenbrot</Text>
          <Text style={styles.tagline}>Sauerteig aus Stockdorf</Text>
        </View>

        <View style={styles.pickupInfo}>
          <Text style={styles.pickupInfoText}>Jetzt bestellen für {pickup.label}</Text>
          <Text style={styles.pickupInfoDate}>{pickup.cutoffLabel}</Text>
        </View>

        {(visiblePickups.length > 0 || subNotices.length > 0) && (
          <View style={styles.pickupCard}>
            <Text style={styles.pickupCardTitle}>{pickupCardTitle}</Text>

            {visiblePickups.map((order) => {
              const ready = isReadyForPickup(order);
              return (
                <TouchableOpacity
                  key={order.id}
                  style={styles.pickupRow}
                  onPress={() => router.push(`/order/${order.id}`)}
                >
                  <View style={[styles.pickupDot, ready && { backgroundColor: theme.colors.primary }]} />
                  <View style={styles.pickupRowText}>
                    <Text style={styles.pickupWhen}>{pickupLabel(order)}</Text>
                    {/* The order number for a one-off, so it can be told apart
                        from an older one at a glance; "Abo" for a subscription
                        order, which has no number until it is charged. */}
                    <Text style={styles.pickupWhat}>
                      {order.order_type === 'subscription'
                        ? 'Abo'
                        : order.order_number ?? 'Bestellung'}
                    </Text>
                  </View>
                  {ready && <Text style={styles.pickupReady}>abholbereit</Text>}
                  <Text style={styles.pickupChevron}>›</Text>
                </TouchableOpacity>
              );
            })}

            {hiddenPickupCount > 0 && (
              <TouchableOpacity onPress={() => setShowAllPickups(true)} hitSlop={8}>
                <Text style={styles.pickupMore}>
                  {hiddenPickupCount} weitere {hiddenPickupCount === 1 ? 'Abholung' : 'Abholungen'} anzeigen
                </Text>
              </TouchableOpacity>
            )}
            {showAllPickups && upcomingOrders.length > VISIBLE_PICKUPS && (
              <TouchableOpacity onPress={() => setShowAllPickups(false)} hitSlop={8}>
                <Text style={styles.pickupMore}>Weniger anzeigen</Text>
              </TouchableOpacity>
            )}

            {/* Ruled off from the pickups above, so the "weitere anzeigen"
                link reads as belonging to the list it actually expands. */}
            {subNotices.map((sub, i) => {
              const failed = sub.status === 'payment_failed';
              return (
                <TouchableOpacity
                  key={sub.id}
                  style={[
                    styles.pickupRow,
                    i === 0 && visiblePickups.length > 0 ? styles.pickupRowDivided : null,
                  ]}
                  onPress={() => router.push('/(tabs)/subscriptions')}
                >
                  {/* Error red (#DC2626), deliberately NOT the brand red: a
                      colour that is almost-but-not-quite the branding reads as
                      a warning rather than as decoration, and it matches the
                      payment_failed dot on the subscriptions screen. Grey for a
                      pause — that is the customer's own choice, not a problem. */}
                  <View
                    style={[
                      styles.pickupDot,
                      { backgroundColor: failed ? theme.colors.error : theme.colors.textLight },
                    ]}
                  />
                  <View style={styles.pickupRowText}>
                    <Text style={[styles.pickupWhen, failed && styles.pickupWhenAlert]}>
                      {failed ? SUBSCRIPTION_STATUS_LABELS.payment_failed : 'Abo pausiert'}
                    </Text>
                    <Text style={styles.pickupWhat}>
                      {failed
                        ? 'Zahlungsmethode aktualisieren, dann läuft dein Abo weiter'
                        : sub.paused_until
                          ? `Läuft am ${new Date(sub.paused_until + 'T12:00:00').toLocaleDateString('de-DE')} weiter`
                          : 'Fortsetzen in den Abos'}
                    </Text>
                  </View>
                  <Text style={styles.pickupChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={styles.sectionTitle}>Unser Sortiment</Text>

        {products.map((product) => {
          const qty = cartQuantity(product.id);
          const isSoldOut = soldOut[product.id] === true;
          return (
            <View key={product.id} style={styles.productItem}>
              <ProductCard
                product={product}
                available={!isSoldOut}
                quantity={qty}
                onPress={() => setDetailProduct(product)}
                onIncrease={() => handleIncrease(product)}
                onDecrease={() => handleDecrease(product)}
                onAdd={() => handleIncrease(product)}
              />
            </View>
          );
        })}
      </ScrollView>

      {itemCount > 0 && (
        <View style={styles.cartBar}>
          <Text style={styles.cartBarText}>
            {itemCount} {itemCount === 1 ? 'Artikel' : 'Artikel'} · {(totalCents / 100).toFixed(2).replace('.', ',')} €
          </Text>
          <Button title="Zum Warenkorb" onPress={() => router.push('/(tabs)/cart')} size="sm" />
        </View>
      )}

      <ProductDetailModal
        product={detailProduct}
        visible={!!detailProduct}
        onClose={() => setDetailProduct(null)}
        onAdd={handleAddToCart}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.lg, paddingBottom: 96 },
  brandHeader: { alignItems: 'center', marginBottom: theme.spacing.lg },
  logo: { width: 72, height: 72, resizeMode: 'contain' },
  brand: { fontSize: theme.fontSize.xxl, fontWeight: '700', color: theme.colors.text, marginTop: theme.spacing.xs },
  tagline: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  pickupInfo: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  pickupInfoText: { fontSize: theme.fontSize.sm, color: theme.colors.text, fontWeight: '600' },
  pickupInfoDate: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 2 },
  // One card for every upcoming pickup. Sized to take no more room than the two
  // cards it replaced, so the product list keeps its place on the screen.
  pickupCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  pickupCardTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  pickupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm },
  pickupRowDivided: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  pickupDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: theme.colors.success, marginRight: theme.spacing.md,
  },
  pickupRowText: { flex: 1 },
  pickupWhen: { fontSize: theme.fontSize.md, fontWeight: '600', color: theme.colors.text },
  pickupWhat: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: 1 },
  // Same error red as the dot, so brand red keeps meaning "good news, come and
  // collect" and this red means "something needs your attention".
  pickupWhenAlert: { color: theme.colors.error },
  // Brand red, no tinted fill (see the palette rule).
  pickupReady: {
    fontSize: theme.fontSize.sm, fontWeight: '700',
    color: theme.colors.primary, marginRight: theme.spacing.sm,
  },
  pickupChevron: { fontSize: theme.fontSize.lg, color: theme.colors.textLight },
  pickupMore: {
    fontSize: theme.fontSize.sm, color: theme.colors.textLight,
    paddingVertical: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  productItem: { marginBottom: theme.spacing.lg },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  addButton: { flex: 1 },
  cartBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  cartBarText: { fontSize: theme.fontSize.sm, fontWeight: '600', color: theme.colors.text },
});
