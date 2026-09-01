import { supabase } from './supabase';

/**
 * Real per-product availability for a pickup date — the same source the app's
 * "Ausverkauft" badge uses: capacity-manager/check-capacity counts existing
 * (non-cancelled) orders against the product's capacity. An error counts as
 * available; the server-side check in create-payment-intent stays the
 * backstop, this is only the early signal on the card.
 */
export async function fetchSoldOut(
  productIds: string[],
  fulfillmentDate: string,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    productIds.map(async (id) => {
      try {
        const { data } = await supabase.functions.invoke('capacity-manager/check-capacity', {
          body: { product_id: id, fulfillment_date: fulfillmentDate },
        });
        const count = (data as { available_count?: unknown } | null)?.available_count;
        const available = typeof count === 'number' ? count : 1;
        return [id, available <= 0] as const;
      } catch {
        return [id, false] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
