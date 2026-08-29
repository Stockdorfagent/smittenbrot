'use client';

import { useEffect, useState } from 'react';

/**
 * Minimal admin toast — no dependency, no context plumbing. `showToast()` can
 * be called from anywhere (even non-React code); <AdminToasts /> is mounted
 * once in the admin layout and listens for the events.
 *
 * Exists because roughly fifteen admin mutations were `if (!error) {...}`
 * with no else: an RLS rejection or network failure changed nothing on
 * screen and said nothing. Errors must be VISIBLE.
 */
type Toast = { id: number; kind: 'error' | 'success'; text: string };

const EVENT = 'smitten-admin-toast';
let nextId = 1;

export function showToast(text: string, kind: 'error' | 'success' = 'error') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, kind } }));
}

export function AdminToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const { text, kind } = (e as CustomEvent<{ text: string; kind: Toast['kind'] }>).detail;
      const id = nextId++;
      setToasts((prev) => [...prev, { id, kind, text }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg px-4 py-3 text-sm shadow-lg border ${
            t.kind === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-white border-smitten-cream text-smitten-text'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
