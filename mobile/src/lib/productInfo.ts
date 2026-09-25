import type { Product } from './types';

/** Identical for every product → code, not data. Keep in sync with website/src/lib/productInfo.ts. */
export const TRACE_NOTICE =
  'In der gleichen Backstube werden oft auch Eier, Erdnüsse, Milch, Schalenfrüchte, Sellerie, Senf, Sesam und Soja verarbeitet. Spuren dieser Allergene können daher nicht ausgeschlossen werden.';

/**
 * Prose only since 25.09.2026 (legacy "Gewicht:/Zutaten:/Allergene:" lines were
 * migrated into the structured fields and stripped). `main` = the whole prose;
 * the old split at the first blank line hid every paragraph after the first.
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

/** The "Produktinformationen" lines for the detail modal — structured fields only (migration 027). */
export function productInfoLines(p: Product): string {
  const w = p.weight?.trim(), z = p.ingredients?.trim(), a = p.allergens?.trim();
  if (!(w || z || a)) return '';
  return [w && `Gewicht: ${w}`, z && `Zutaten: ${z}`, a && `Allergene: ${a}`, TRACE_NOTICE].filter(Boolean).join('\n');
}
