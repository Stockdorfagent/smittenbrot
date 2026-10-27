'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface ActiveClosure {
  start_date: string;
  end_date: string;
  banner_text_de: string | null;
  reason: string | null;
}

export default function ClosureBanner() {
  const pathname = usePathname();
  const [closure, setClosure] = useState<ActiveClosure | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'active' }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.active) setClosure(data.closure);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Shop banners stay out of the admin area (owner, 27.10.2026).
  if (pathname?.startsWith('/admin')) return null;
  if (loading || !closure) return null;

  return (
    <div className="bg-red-600 text-white text-center px-4 py-3 text-sm font-medium">
      <p>{closure.banner_text_de || 'Aktuell findet keine Produktion statt.'}</p>
      {closure.reason && (
        <p className="text-xs text-red-100 mt-1">{closure.reason}</p>
      )}
    </div>
  );
}
