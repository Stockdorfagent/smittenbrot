import type { Product } from './types';

/**
 * Cross-contamination notice — identical for every product, therefore code, not
 * a per-product field (owner's text, 10.09.2026). Keep in sync with
 * mobile/src/lib/productInfo.ts.
 */
export const TRACE_NOTICE =
  'In der gleichen Backstube werden oft auch Eier, Erdnüsse, Milch, Schalenfrüchte, Sellerie, Senf, Sesam und Soja verarbeitet. Spuren dieser Allergene können daher nicht ausgeschlossen werden.';

/** True when at least one structured info field is filled. */
export function hasProductInfo(p: Pick<Product, 'weight' | 'ingredients' | 'allergens'>): boolean {
  return Boolean(p.weight?.trim() || p.ingredients?.trim() || p.allergens?.trim());
}

/**
 * Legacy convention: the description holds the prose first, then a blank line,
 * then "Gewicht:/Zutaten:/Allergene:" lines and the trace notice. Cards show
 * only the prose; the detail page shows the rest through the info block until a
 * product has its structured fields filled (then the legacy tail is ignored so
 * nothing appears twice).
 */
export function splitDescription(desc: string | null | undefined): { main: string; legacyInfo: string } {
  const d = desc ?? '';
  const i = d.indexOf('\n\n');
  return i >= 0 ? { main: d.slice(0, i), legacyInfo: d.slice(i + 2) } : { main: d, legacyInfo: '' };
}
