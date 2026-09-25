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
 * The description is prose only since 25.09.2026 (the legacy
 * "Gewicht:/Zutaten:/Allergene:" tail was moved into the structured fields and
 * stripped from every product). `main` is the WHOLE prose — the old split at
 * the first blank line hid every paragraph after the first. Any such legacy
 * line that still shows up (a product edited by hand later) is dropped here
 * rather than shown twice; `legacyInfo` is kept only for the call signature.
 */
export function splitDescription(desc: string | null | undefined): { main: string; legacyInfo: string } {
  const main = (desc ?? '')
    .split('\n')
    .filter((l) => !/^(Gewicht|Zutaten|Allergene):/i.test(l.trim()) && !l.trim().startsWith('In der gleichen Backstube'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { main, legacyInfo: '' };
}
