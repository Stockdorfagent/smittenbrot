import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Ich habe mein Brot abgeholt" — a purely COSMETIC, device-local mark.
 *
 * The system cannot know when bread actually leaves the cabinet, so
 * "Abholbereit" flips to "Abgeholt" only at the next calendar day
 * (orderStatus.ts). Customers who have collected may tap the order to flip it
 * immediately — for their own eyes only. Deliberately NOT stored server-side
 * and never shown to the admin: customers would forget to tap, so as a signal
 * it would be worthless, and as a column it would invite trusting it.
 *
 * Storage: { [orderId]: 'YYYY-MM-DD' (day marked) }, pruned after 14 days —
 * by then the date rule has long taken over and the entry is dead weight.
 */
const KEY = 'smittenbrot.pickedUpOrders';
const KEEP_DAYS = 14;

type Store = Record<string, string>;

function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const store: Store = raw ? JSON.parse(raw) : {};
    const cutoff = localDateISO(new Date(Date.now() - KEEP_DAYS * 86400000));
    let pruned = false;
    for (const [id, day] of Object.entries(store)) {
      if (typeof day !== 'string' || day < cutoff) {
        delete store[id];
        pruned = true;
      }
    }
    if (pruned) await AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {});
    return store;
  } catch {
    return {};
  }
}

export async function loadPickedUp(): Promise<Set<string>> {
  return new Set(Object.keys(await loadStore()));
}

export async function markPickedUp(orderId: string): Promise<void> {
  try {
    const store = await loadStore();
    store[orderId] = localDateISO(new Date());
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // cosmetic — never let storage trouble surface
  }
}

export async function unmarkPickedUp(orderId: string): Promise<void> {
  try {
    const store = await loadStore();
    delete store[orderId];
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // cosmetic
  }
}
