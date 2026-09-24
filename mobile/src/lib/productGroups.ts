import type { Product, ProductDisplayGroup } from './types';

/**
 * Shop sections (owner, 21./24.09.2026) — same labels and order as the website
 * (website/src/lib/productGroups.ts). Display grouping ONLY: the list handed in
 * is already filtered for the pickup day and the current week. Customer-facing
 * labels never mention the A/B cycle. Manual sort_order is kept within a section.
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

/** Non-empty sections in page order; input order is preserved. */
export function groupProducts(products: Product[]): ProductSection[] {
  const buckets = new Map<ProductDisplayGroup, Product[]>(
    DISPLAY_GROUP_ORDER.map((g) => [g, [] as Product[]]),
  );
  for (const p of products) {
    const g: ProductDisplayGroup =
      p.display_group && buckets.has(p.display_group) ? p.display_group : 'classic';
    buckets.get(g)!.push(p);
  }
  return DISPLAY_GROUP_ORDER
    .map((group) => ({ group, label: displayGroupLabels[group], products: buckets.get(group)! }))
    .filter((s) => s.products.length > 0);
}
