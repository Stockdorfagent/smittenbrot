import type { Product } from './types';

/** Identical for every product → code, not data. Keep in sync with website/src/lib/productInfo.ts. */
export const TRACE_NOTICE =
  'In der gleichen Backstube werden oft auch Eier, Erdnüsse, Milch, Schalenfrüchte, Sellerie, Senf, Sesam und Soja verarbeitet. Spuren dieser Allergene können daher nicht ausgeschlossen werden.';

export function splitDescription(desc: string | null | undefined): { main: string; legacyInfo: string } {
  const d = desc ?? '';
  const i = d.indexOf('\n\n');
  return i >= 0 ? { main: d.slice(0, i).trim(), legacyInfo: d.slice(i + 2) } : { main: d.trim(), legacyInfo: '' };
}

/**
 * The "Produktinformationen" lines for the detail modal. Structured fields
 * (migration 027) win; products not yet migrated fall back to the legacy tail of
 * the description, so nothing appears twice and nothing disappears.
 */
export function productInfoLines(p: Product): string {
  const w = p.weight?.trim(), z = p.ingredients?.trim(), a = p.allergens?.trim();
  if (w || z || a) {
    return [w && `Gewicht: ${w}`, z && `Zutaten: ${z}`, a && `Allergene: ${a}`, TRACE_NOTICE].filter(Boolean).join('\n');
  }
  return splitDescription(p.description).legacyInfo;
}
