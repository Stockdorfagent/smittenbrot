import type { Product, ProductDisplayGroup } from './types';

/**
 * Sections of the /products shop page (owner, 21.09.2026; 'Extras' instead of
 * 'Saisonales & Besonderes' since 21.09. evening: shorter, less marketing). Purely a display
 * grouping of products that are ALREADY filtered for the selected pickup day
 * and the current week — availability is decided before this runs, here only
 * the order on the page. Customer-facing labels never mention the A/B cycle.
 * Within a section the admin's manual `sort_order` is kept as is.
 */
export const DISPLAY_GROUP_ORDER: ProductDisplayGroup[] = ['classic', 'weekly', 'special'];

export const displayGroupLabels: Record<ProductDisplayGroup, string> = {
  classic: 'Klassiker',
  weekly: 'Diese Woche',
  special: 'Extras',
};

export interface ProductSection {
  group: ProductDisplayGroup;
  label: string;
  products: Product[];
}

/** Non-empty sections in page order; input order (sort_order) is preserved. */
export function groupProducts(products: Product[]): ProductSection[] {
  const buckets = new Map<ProductDisplayGroup, Product[]>(
    DISPLAY_GROUP_ORDER.map((g) => [g, [] as Product[]]),
  );
  for (const p of products) {
    // Unknown/missing value (older rows, other clients) falls back to the staples.
    const g: ProductDisplayGroup = buckets.has(p.display_group) ? p.display_group : 'classic';
    buckets.get(g)!.push(p);
  }
  return DISPLAY_GROUP_ORDER
    .map((group) => ({ group, label: displayGroupLabels[group], products: buckets.get(group)! }))
    .filter((s) => s.products.length > 0);
}
