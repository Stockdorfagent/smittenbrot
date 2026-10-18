'use client';

/** Small shared pieces for the production pages — same look as the rest of the admin, English labels. */
import Link from 'next/link';
import type { ReactNode } from 'react';

export const inputCls = 'px-3 py-2 rounded-lg border border-smitten-cream text-sm bg-smitten-surface text-smitten-text focus:outline-none focus:ring-2 focus:ring-smitten-accent';
export const smallInputCls = 'px-2 py-1 rounded-md border border-smitten-cream text-sm bg-smitten-surface text-smitten-text focus:outline-none focus:ring-2 focus:ring-smitten-accent';
export const btnPrimary = 'px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors disabled:opacity-50';
export const btnSecondary = 'px-4 py-2 border border-smitten-cream text-smitten-text text-sm rounded-lg hover:bg-smitten-cream transition-colors disabled:opacity-50';
export const btnDanger = 'px-3 py-1.5 text-sm rounded-lg text-red-700 hover:bg-red-50 transition-colors';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div>
        <h1 className="text-2xl font-display font-bold text-smitten-text">{title}</h1>
        {subtitle && <p className="text-sm text-smitten-text/60 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`bg-smitten-surface rounded-xl border border-smitten-cream p-5 ${className ?? ''}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          {title && <h2 className="font-display font-bold text-smitten-text">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="block text-xs text-smitten-text/60 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-smitten-text/40 mt-1">{hint}</span>}
    </label>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'warning' | 'info' | 'success'; children: ReactNode }) {
  const cls = {
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    success: 'bg-green-50 border-green-200 text-green-900',
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export const SUB_NAV = [
  { href: '/admin/production', label: 'Bake days' },
  { href: '/admin/production/recipes', label: 'Recipes' },
  { href: '/admin/production/ingredients', label: 'Ingredients' },
  { href: '/admin/production/products', label: 'Products' },
  { href: '/admin/production/b2b', label: 'B2B' },
  { href: '/admin/production/freezer', label: 'Freezer' },
  { href: '/admin/production/ingredient-lists', label: 'Zutaten lists' },
  { href: '/admin/production/settings', label: 'Settings' },
  { href: '/admin/production/import', label: 'Import / backup' },
];

export function SubNav({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap gap-1 mb-6 print:hidden">
      {SUB_NAV.map((n) => (
        <Link key={n.href} href={n.href} className={`px-3 py-1.5 rounded-lg text-sm ${current === n.href ? 'bg-smitten-primary text-white' : 'text-smitten-text/70 hover:bg-smitten-cream'}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export const th = 'text-left text-xs font-medium uppercase tracking-wider text-smitten-text/50 px-3 py-2';
export const td = 'px-3 py-2 text-sm text-smitten-text align-top';
export const tdNum = 'px-3 py-2 text-sm text-smitten-text text-right tabular-nums align-top';

/** Render **…** as bold (the same markers the customer ingredient list uses). */
export function Bold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return <>{parts.map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)}</>;
}
