'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { useCart } from '@/context/CartContext';

export default function NavBar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { itemCount } = useCart();
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription?.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <nav className="border-b border-smitten-cream bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="font-display text-xl text-smitten-text font-bold flex items-center gap-2">
          <img src="/small-logo.png" alt="Smittenbrot" className="h-8 w-auto" />
          Smittenbrot
        </a>
        <div className="flex items-center gap-6 text-sm text-smitten-text/80">
          <a href="/products" className="hover:text-smitten-primary transition-colors">Sortiment</a>
          <a href="/subscriptions" className="hover:text-smitten-primary transition-colors">Abo</a>
          <a href="/about" className="hover:text-smitten-primary transition-colors">Über Smittenbrot</a>
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
              <a href="/profile" className="text-smitten-text/50 hover:text-smitten-primary transition-colors text-sm">
                Mein Konto
              </a>
              <button onClick={handleLogout} className="text-smitten-text/30 hover:text-smitten-primary text-sm transition-colors">
                Abmelden
              </button>
            </>
          ) : (
            <a href="/login" className="bg-smitten-primary text-white px-4 py-2 rounded-full text-sm hover:bg-smitten-primary/90 transition-colors">
              Anmelden
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
