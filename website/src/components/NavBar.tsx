'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { useCart } from '@/context/CartContext';

const navLinks = [
  { href: '/products', label: 'Sortiment' },
  { href: '/subscriptions', label: 'Abo' },
  { href: '/about', label: 'Über Smittenbrot' },
];

export default function NavBar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { itemCount } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <nav className="border-b border-smitten-cream bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="font-display text-xl text-smitten-text font-bold flex items-center gap-2 shrink-0">
          <img src="/small-logo.png" alt="Smittenbrot" className="h-8 w-auto" />
          <span className="hidden sm:inline">Smittenbrot</span>
        </a>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-6 text-sm text-smitten-text/80">
          {navLinks.map(link => (
            <a key={link.href} href={link.href} className="hover:text-smitten-primary transition-colors">{link.label}</a>
          ))}
          <a href="/cart" className="hover:text-smitten-primary transition-colors relative">
            Warenkorb
            {itemCount > 0 && (
              <span className="absolute -top-2 -right-4 bg-smitten-primary text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            )}
          </a>
          {user ? (
            <>
              <span className="w-px h-5 bg-smitten-cream"></span>
              <a href="/profile" className="text-smitten-text/50 hover:text-smitten-primary transition-colors text-sm">Mein Konto</a>
              <button onClick={handleLogout} className="text-smitten-text/30 hover:text-smitten-primary text-sm transition-colors">Abmelden</button>
            </>
          ) : (
            <a href="/login" className="bg-smitten-primary text-white px-4 py-2 rounded-full text-sm hover:bg-smitten-primary/90 transition-colors">Anmelden</a>
          )}
        </div>

        {/* Mobile: cart icon + hamburger */}
        <div className="flex lg:hidden items-center gap-3">
          <a href="/cart" className="relative p-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-smitten-text/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {itemCount > 0 && (
              <span className="absolute top-0 right-0 bg-smitten-primary text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{itemCount > 9 ? '9+' : itemCount}</span>
            )}
          </a>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2" aria-label="Menü">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-smitten-text/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-smitten-cream bg-white/95 backdrop-blur-sm">
          <div className="px-4 py-4 space-y-2">
            {navLinks.map(link => (
              <a key={link.href} href={link.href}
                className="block px-3 py-2.5 rounded-lg text-sm text-smitten-text/80 hover:bg-smitten-cream hover:text-smitten-primary transition-colors"
                onClick={() => setMobileOpen(false)}>
                {link.label}
              </a>
            ))}
            <hr className="border-smitten-cream my-2" />
            {user ? (
              <>
                <a href="/profile" className="block px-3 py-2.5 rounded-lg text-sm text-smitten-text/80 hover:bg-smitten-cream hover:text-smitten-primary transition-colors"
                   onClick={() => setMobileOpen(false)}>Mein Konto</a>
                <button onClick={handleLogout}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors">Abmelden</button>
              </>
            ) : (
              <a href="/login" className="block text-center bg-smitten-primary text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-smitten-primary/90 transition-colors"
                 onClick={() => setMobileOpen(false)}>Anmelden</a>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
