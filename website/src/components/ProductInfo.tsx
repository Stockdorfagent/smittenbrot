import type { Product } from '@/lib/types';
import { TRACE_NOTICE, hasProductInfo } from '@/lib/productInfo';

/**
 * Uniform "Produktinformationen" block under the description: grey, one size
 * smaller, clearly separated from the prose. Structured fields only (the legacy
 * lines inside the description were migrated + stripped on 25.09.2026).
 */
/** `**Weizen**mehl` → <strong>Weizen</strong>mehl (LMIV Art. 21: allergen emphasised). */
function Emphasised({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return <>{parts.map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-semibold text-smitten-text">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)}</>;
}

export default function ProductInfo({ product }: { product: Product }) {
  const rows: { label: string; value: string }[] = [];
  let trace = false;
  if (hasProductInfo(product)) {
    if (product.weight?.trim()) rows.push({ label: 'Gewicht', value: product.weight.trim() });
    // The generated list (step 1b, with emphasis markers) wins over the legacy plain text.
    const zutaten = product.ingredients_generated?.trim() || product.ingredients?.trim();
    if (zutaten) rows.push({ label: 'Zutaten', value: zutaten });
    if (product.allergens?.trim()) rows.push({ label: 'Allergene', value: product.allergens.trim() });
    trace = true;
  }
  if (rows.length === 0 && !trace) return null;
  return (
    <div className="mt-6 pt-4 border-t border-smitten-cream text-sm text-smitten-secondary leading-relaxed">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-2">Produktinformationen</p>
      {rows.map((r) => (
        <p key={r.label} className="mb-0.5">
          <span className="font-semibold">{r.label}:</span> <Emphasised text={r.value} />
        </p>
      ))}
      {trace && <p className="mt-2 italic">{TRACE_NOTICE}</p>}
    </div>
  );
}
