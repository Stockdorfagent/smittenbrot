/**
 * Thin black bar above the navigation announcing the welcome code (owner,
 * 11.09.2026 — the Squarespace site had the same kind of strip). Brand palette:
 * black background, white text, the code in brand red. To retire it, delete the
 * <PromoBanner/> line in app/layout.tsx or set PROMO to null.
 */
const PROMO: { text: string; code: string; suffix: string } | null = {
  text: 'Neu hier? 50 % Rabatt auf deine erste Bestellung mit dem Code',
  code: 'WILLKOMMEN26',
  suffix: '– einfach an der Kasse eingeben.',
};

export default function PromoBanner() {
  if (!PROMO) return null;
  return (
    <div className="bg-black text-white text-center px-4 py-2 text-xs sm:text-sm">
      {PROMO.text}{' '}
      <span className="font-bold tracking-wide text-smitten-primary">{PROMO.code}</span>{' '}
      <span className="hidden sm:inline">{PROMO.suffix}</span>
    </div>
  );
}
