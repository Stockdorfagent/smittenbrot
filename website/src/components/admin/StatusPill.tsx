/**
 * The one status pill. Every admin page used to hand-roll the same
 * `text-xs px-2 py-0.5 rounded-full bg-x-100 text-x-700` span with its own
 * ternary chain — six drifting copies. Semantic colours are deliberate here
 * (owner's call): green = good/done, amber = attention, red = problem/active
 * closure, blue = planned/neutral, gray = inactive/past. Brand red stays
 * reserved for "come and collect" moments.
 */
const TONES = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  gray: 'bg-gray-100 text-gray-500',
  brand: 'bg-smitten-primary text-white',
} as const;

export type PillTone = keyof typeof TONES;

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${TONES[tone]}${className ? ` ${className}` : ''}`}
    >
      {children}
    </span>
  );
}
