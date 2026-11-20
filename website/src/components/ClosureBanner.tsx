'use client';

import { usePathname } from 'next/navigation';
import { useClosures } from '@/context/ClosureContext';
import { announcedClosure, closureBannerText, berlinTodayISO } from '@/lib/pickup';

/**
 * Site-wide Schließzeit banner. Since 20.11.2026 it appears 14 days BEFORE
 * the closure starts (not only while it runs), because that is when the
 * shop already skips the closed pickup days and customers need to know why.
 * Text: the owner's banner text, or a generated one naming the dates and
 * the first bake day after the closure.
 */
export default function ClosureBanner() {
  const pathname = usePathname();
  const { closures, loaded } = useClosures();

  // Shop banners stay out of the admin area (owner, 27.10.2026).
  if (pathname?.startsWith('/admin')) return null;
  if (!loaded) return null;
  const closure = announcedClosure(closures, berlinTodayISO());
  if (!closure) return null;

  return (
    <div className="bg-red-600 text-white text-center px-4 py-3 text-sm font-medium">
      <p>{closureBannerText(closure, closures)}</p>
      {closure.reason && (
        <p className="text-xs text-red-100 mt-1">{closure.reason}</p>
      )}
    </div>
  );
}
