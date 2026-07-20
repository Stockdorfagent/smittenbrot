'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';
import { getNextPickup } from '@/lib/pickup';
import Link from 'next/link';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [pickupLabel, setPickupLabel] = useState('');

  useEffect(() => {
    async function fetchProducts() {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .in('cycle', ['permanent', 'week_a', 'week_b'])
        .order('sort_order', { ascending: true });
      if (error) console.error('[homepage] fetch error:', error);
      if (data) setProducts(data);
    }
    fetchProducts();
  }, []);

  useEffect(() => {
    setPickupLabel(getNextPickup().label);
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-smitten-cream/70 to-white">
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-16 md:pt-28 md:pb-24 text-center">
          <img
            src="/logo.svg"
            alt="Smittenbrot"
            className="mx-auto h-40 md:h-56 w-auto"
          />
          <h1 className="sr-only">Smittenbrot — Sauerteig aus Stockdorf</h1>
          <p className="mt-6 text-xs md:text-sm font-semibold uppercase tracking-[0.22em] text-smitten-primary">
            Sauerteig aus Stockdorf
          </p>
          <p className="mt-5 text-lg md:text-xl text-smitten-secondary max-w-xl mx-auto leading-relaxed">
            Hol dir den Duft von echtem Handwerk auf deinen Tisch. Jeden Mittwoch
            und Samstag frisch und exklusiv auf Bestellung gebacken.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/products"
              className="w-full sm:w-auto bg-smitten-primary text-white px-8 py-3.5 rounded-full text-base font-semibold hover:bg-smitten-primary/90 transition-colors shadow-sm"
            >
              Jetzt bestellen
            </Link>
            <Link
              href="/subscriptions/create"
              className="w-full sm:w-auto border border-smitten-text/15 text-smitten-text px-8 py-3.5 rounded-full text-base font-semibold hover:border-smitten-text/40 transition-colors"
            >
              Abo einrichten
            </Link>
          </div>
          {pickupLabel && (
            <p className="mt-6 text-sm text-smitten-secondary">
              Nächste mögliche Abholung: <strong className="text-smitten-text font-semibold">{pickupLabel}</strong>
            </p>
          )}
        </div>
      </section>

      {/* Sortiment preview */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-20">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-smitten-text">
              Diese Woche im Sortiment
            </h2>
            <p className="mt-1 text-sm text-smitten-secondary">
              Jede Woche frisch von Hand gebacken.
            </p>
          </div>
          <Link
            href="/products"
            className="hidden sm:inline shrink-0 text-sm font-semibold text-smitten-primary hover:underline"
          >
            Alle ansehen →
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.slice(0, 6).map(product => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="group block bg-white rounded-2xl overflow-hidden border border-smitten-cream hover:border-smitten-text/15 hover:shadow-md transition-all"
            >
              <div className="aspect-[4/3] bg-smitten-cream overflow-hidden">
                {product.cover_image_url ? (
                  <img
                    src={product.cover_image_url}
                    alt={product.alt_text || product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-smitten-secondary/50">
                    {product.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-bold text-smitten-text truncate">{product.name}</h3>
                  <span className="shrink-0 font-semibold text-smitten-text">
                    {formatPrice(product.price_cents)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-smitten-secondary line-clamp-2">
                  {product.description}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link href="/products" className="text-sm font-semibold text-smitten-primary hover:underline">
            Alle ansehen →
          </Link>
        </div>
      </section>

      {/* So funktioniert's */}
      <section className="bg-smitten-cream/60 py-16 md:py-20">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-smitten-text">
            So funktioniert&rsquo;s
          </h2>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { step: '1', title: 'Auswählen', desc: 'Stöbere durch das wöchentliche Sortiment und wähle deine Lieblingsbackwaren aus.' },
              { step: '2', title: 'Vorbestellen', desc: 'Ich backe nach dem „No Waste"-Prinzip: bestelle vorab online. Bestellschluss ist Montag- bzw. Donnerstagabend um 22:00. Bezahle bequem per Karte, Apple Pay oder Google Pay.' },
              { step: '3', title: 'Abholen', desc: 'Du bekommst eine E-Mail, sobald dein Brot bereitliegt – spätestens um 14:00 Uhr. Abholung an der Waldstraße 1 in Stockdorf, 5 Min. vom S-Bahnhof.' },
            ].map(item => (
              <div key={item.step} className="bg-white rounded-2xl p-7 border border-smitten-cream text-center">
                <div className="w-11 h-11 rounded-full bg-smitten-primary text-white flex items-center justify-center text-lg font-bold mx-auto">
                  {item.step}
                </div>
                <h3 className="mt-5 text-lg font-bold text-smitten-text">{item.title}</h3>
                <p className="mt-2 text-sm text-smitten-secondary leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <Link
            href="/how-it-works"
            className="mt-10 inline-block text-sm font-semibold text-smitten-primary hover:underline"
          >
            Mehr zum Ablauf →
          </Link>
        </div>
      </section>

      {/* Abonnement */}
      <section className="max-w-3xl mx-auto px-4 py-16 md:py-24 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-smitten-primary">Abonnement</p>
        <h2 className="mt-3 text-2xl md:text-3xl font-bold text-smitten-text">
          Nie wieder frisches Brot verpassen
        </h2>
        <p className="mt-4 text-smitten-secondary leading-relaxed">
          Mit dem Abo-Service kannst du wöchentlich wiederkehrende Bestellungen
          aufgeben. Wähle deine Produkte, lege den Abholtag fest und ich backe
          jede Woche für dich. Jederzeit pausierbar oder kündbar.
        </p>
        <Link
          href="/subscriptions"
          className="mt-7 inline-block bg-smitten-text text-white px-8 py-3.5 rounded-full font-semibold hover:bg-smitten-text/90 transition-colors"
        >
          Mehr erfahren
        </Link>
      </section>
    </div>
  );
}
