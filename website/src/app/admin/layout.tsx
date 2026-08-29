'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { AdminToasts } from '@/components/admin/toast';

/**
 * Client-side UX gate only — the real boundary is Postgres RLS (is_admin())
 * plus requireAdmin in every admin API route. The env var keeps this in sync
 * with the server-side ADMIN_EMAIL; the literal is the deployed default.
 */
const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'sophia@smittenbrot.de';

/** Grouped by how the owner works: daily operations, people, bookkeeping. */
const navGroups = [
  {
    title: 'Betrieb',
    items: [
      { href: '/admin', label: 'Dashboard' },
      { href: '/admin/orders', label: 'Bestellungen' },
      { href: '/admin/products', label: 'Produkte' },
      { href: '/admin/pickup-locations', label: 'Abholorte' },
      { href: '/admin/closures', label: 'Schließzeiten' },
    ],
  },
  {
    title: 'Kunden',
    items: [
      { href: '/admin/customers', label: 'Kunden' },
      { href: '/admin/subscriptions', label: 'Abos' },
      { href: '/admin/discounts', label: 'Rabattcodes' },
      { href: '/admin/notifications', label: 'Benachrichtigungen' },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/exports', label: 'Exporte' },
      { href: '/admin/settings', label: 'Einstellungen' },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push('/login');
      return;
    }
    const user = session.user;
    const admin = user.email === ADMIN_EMAIL;
    if (!admin) {
      router.push('/login');
      return;
    }
    setIsAdmin(true);
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-smitten-bg">
        <p className="text-smitten-text/40">Lädt...</p>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-smitten-bg flex">
      <AdminToasts />
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-full w-64 bg-white border-r border-smitten-cream flex flex-col transform transition-transform lg:transform-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-6 border-b border-smitten-cream">
          <Link href="/admin" className="font-display text-xl font-bold text-smitten-text flex items-center gap-2">
            <img src="/small-logo.png" alt="Smittenbrot" className="h-6 w-auto" />
            Smittenbrot
          </Link>
          <p className="text-xs text-smitten-text/40 mt-0.5">Admin Bereich</p>
        </div>

        <nav className="flex-1 p-4 space-y-5 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="px-4 mb-1 text-[11px] font-medium uppercase tracking-wider text-smitten-text/40">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-smitten-primary text-white'
                          : 'text-smitten-text/70 hover:bg-smitten-cream hover:text-smitten-primary'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-smitten-cream">
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2.5 rounded-lg text-sm text-smitten-text/60 hover:bg-smitten-cream transition-colors"
          >
            Abmelden
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="bg-white border-b border-smitten-cream px-6 h-16 flex items-center justify-between sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-smitten-primary p-2 -ml-2"
            aria-label="Menü öffnen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="hidden lg:block" />
          {/* Working header, nothing else: the legal links belong to the shop
              footer, not to the owner's toolbar, and the second logout was a
              duplicate of the sidebar's. */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-smitten-text/60">Smittenbrot Admin</span>
            <Link
              href="/"
              className="text-sm text-smitten-text/60 hover:text-smitten-primary transition-colors"
            >
              Zum Shop
            </Link>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
