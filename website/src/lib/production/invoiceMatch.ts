/**
 * Phase 2 of the deliveries (owner, 29.10.2026): an invoice read by the model
 * becomes a DRAFT delivery. Pure matching, no I/O:
 *   supplier  → pr_suppliers by name (contains, case-insensitive)
 *   line      → ingredient via the remembered supplier items (same supplier,
 *               same wording) first, then by word overlap with the ingredient
 *               names (internal + German); pack sizes converted to the
 *               ingredient's unit (kg → g, l/ml → g, pieces as pieces).
 * Nothing is booked here — the owner sees the draft and confirms.
 */
import type { Ingredient, ProductionData, Supplier, SupplierItem } from './types';

export interface ExtractedLine {
  description: string;
  quantity: number | null;              // packs
  pack_size_value: number | null;
  pack_size_unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs' | null;
  line_net_cents: number | null;
  best_before: string | null;           // YYYY-MM-DD
  is_fee_or_deposit: boolean;           // delivery fee, deposit, packaging surcharge
}
export interface ExtractedInvoice {
  supplier: string | null;
  invoice_date: string | null;          // YYYY-MM-DD
  invoice_no: string | null;
  delivery_fee_net_cents: number | null;
  lines: ExtractedLine[];
}

export interface MatchedLine {
  ingredient_id: string | null;
  item_text: string;
  qty: number;
  pack_amount: number | null;           // ingredient unit
  price_cents: number;
  bbf: string | null;
  how: 'remembered' | 'name' | 'none';
}
export interface MatchedInvoice {
  supplier_id: string | null;
  supplier_name: string | null;         // for "create supplier" when unmatched
  date: string;
  invoice_no: string | null;
  delivery_fee_cents: number;
  lines: MatchedLine[];
  notes: string[];                      // what the owner should look at
}

const STOP = new Set(['und', 'mit', 'der', 'die', 'das', 'von', 'the', 'and', 'bio', 'kg', 'g', 'stk', 'stück', 'sack', 'beutel', 'pack', 'karton', 'flour', 'mehl', 'type']);
export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9äöüß]+/g, ' ').split(' ')
    .map((t) => t.replace(/^t(\d+)$/, '$1'))                  // "t550" → "550"
    .filter((t) => t.length >= 3 || /^\d+$/.test(t)).filter((t) => !STOP.has(t));
}
function overlap(a: string[], b: string[]): number {
  const B = new Set(b);
  let n = 0;
  for (const t of new Set(a)) if (B.has(t)) n += /^\d+$/.test(t) ? 2 : 1;   // numbers (550, 1050) are the strongest signal
  return n;
}

/** Convert an invoice pack size to the ingredient's unit. */
export function toUnit(value: number | null, unit: ExtractedLine['pack_size_unit'], ingredientUnit: Ingredient['unit']): number | null {
  if (value === null || !(value > 0)) return null;
  if (ingredientUnit === 'pcs') return unit === 'pcs' || unit === null ? value : null;
  switch (unit) {
    case 'kg': case 'l': return value * 1000;
    case 'g': case 'ml': return value;
    case 'pcs': return null;                                   // pieces of a gram ingredient: unknown weight
    default: return value;                                     // unit missing: assume the ingredient's unit
  }
}

export function matchInvoice(x: ExtractedInvoice, data: ProductionData, suppliers: Supplier[], items: SupplierItem[], today: string): MatchedInvoice {
  const notes: string[] = [];
  const supName = (x.supplier ?? '').trim();
  const supplier = supName ? suppliers.find((s) => s.name.toLowerCase() === supName.toLowerCase())
    ?? suppliers.find((s) => supName.toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(supName.toLowerCase())) : undefined;
  if (supName && !supplier) notes.push(`Supplier "${supName}" is new.`);
  if (!supName) notes.push('No supplier found on the invoice.');

  const candidates = data.ingredients.filter((i) => !i.derived_from);
  const ingTokens = new Map(candidates.map((i) => [i.id, [...tokens(i.name), ...tokens(i.name_de ?? '')]]));
  const mine = supplier ? items.filter((it) => it.supplier_id === supplier.id) : [];
  const itemTokens = mine.map((it) => ({ it, t: tokens(it.item_text ?? '') }));

  let fee = x.delivery_fee_net_cents ?? 0;
  const lines: MatchedLine[] = [];
  for (const l of x.lines) {
    if (l.is_fee_or_deposit) { if (!x.delivery_fee_net_cents && /liefer|versand|fracht|shipping|delivery|transport/i.test(l.description)) fee += l.line_net_cents ?? 0; continue; }
    const lt = tokens(l.description);
    let best: { id: string; how: MatchedLine['how']; pack: number | null } | null = null;
    // 1. remembered wording of this supplier
    let bestScore = 0;
    for (const { it, t } of itemTokens) {
      const s = overlap(lt, t) + ((it.item_text ?? '').toLowerCase() === l.description.toLowerCase() ? 10 : 0);
      if (s > bestScore) { bestScore = s; best = { id: it.ingredient_id, how: 'remembered', pack: it.pack_amount }; }
    }
    // 2. ingredient names
    if (!best) {
      bestScore = 0;
      for (const i of candidates) {
        const s = overlap(lt, ingTokens.get(i.id) ?? []);
        if (s > bestScore) { bestScore = s; best = { id: i.id, how: 'name', pack: null }; }
      }
    }
    const ing = best ? candidates.find((i) => i.id === best!.id) : undefined;
    const fromInvoice = ing ? toUnit(l.pack_size_value, l.pack_size_unit, ing.unit) : null;
    const pack = fromInvoice ?? best?.pack ?? null;
    if (!ing) notes.push(`"${l.description}": no matching ingredient — choose one.`);
    else if (!pack) notes.push(`"${l.description}": pack size unclear — enter it.`);
    lines.push({ ingredient_id: ing?.id ?? null, item_text: l.description, qty: l.quantity && l.quantity > 0 ? l.quantity : 1, pack_amount: pack, price_cents: Math.max(0, Math.round(l.line_net_cents ?? 0)), bbf: ing?.track_bbf ? l.best_before : null, how: best?.how ?? 'none' });
  }
  if (lines.length === 0) notes.push('No product lines found on the invoice.');
  return { supplier_id: supplier?.id ?? null, supplier_name: supName || null, date: x.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date) ? x.invoice_date : today, invoice_no: x.invoice_no, delivery_fee_cents: Math.max(0, Math.round(fee)), lines, notes };
}
