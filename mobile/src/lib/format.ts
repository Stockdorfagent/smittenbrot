/**
 * Money, formatted German-style: 4,00 €
 *
 * One helper so the app, the website and the emails cannot drift apart — a
 * tester spotted prices written as "4.00€" in some places and "4,00 €" in
 * others. German uses a comma as the decimal separator and puts the symbol
 * after the amount.
 */
export function formatPrice(cents: number): string {
  return `${((cents ?? 0) / 100).toFixed(2).replace('.', ',')} €`;
}
