'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';
import Link from 'next/link';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);

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

  return (
    <div>
      <section className="relative bg-gradient-to-b from-smitten-cream to-smitten-bg py-24 md:py-36">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-display font-bold text-smitten-text">
            Smittenbrot
          </h1>
          <p className="mt-4 text-lg md:text-xl text-smitten-secondary max-w-xl mx-auto">
            Hol dir den Duft von echtem Handwerk auf deinen Tisch.{' '}
            <span className="text-smitten-primary italic">Smittenbrot</span>{' '}
            wird jeden Mittwoch und Samstag frisch und exklusiv auf Bestellung für dich gebacken.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/products"
              className="bg-smitten-primary text-white px-8 py-3 rounded-full text-lg font-medium hover:bg-smitten-primary/90 transition-colors"
            >
              Jetzt bestellen
            </Link>
            <Link
              href="/subscriptions/create"
              className="border-2 border-smitten-primary text-smitten-text px-8 py-3 rounded-full text-lg font-medium hover:bg-smitten-primary/5 transition-colors"
            >
              Abo einrichten
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-smitten-text text-center">
          Diese Woche im Sortiment
        </h2>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(product => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="group bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-smitten-cream"
            >
              <div className="w-full h-40 bg-smitten-cream rounded-lg overflow-hidden">
                {product.cover_image_url ? (
                  <img
                    src={product.cover_image_url}
                    alt={product.alt_text || product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl font-display text-smitten-secondary group-hover:scale-105 transition-transform">
                    {product.name.charAt(0)}
                  </div>
                )}
              </div>
              <h3 className="mt-4 font-display text-lg text-smitten-text font-bold">
                {product.name}
              </h3>
              <p className="mt-1 text-sm text-smitten-text/60 line-clamp-2">
                {product.description}
              </p>
              <p className="mt-2 font-medium text-smitten-text">
                {formatPrice(product.price_cents)}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-smitten-cream py-16">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-display font-bold text-smitten-text">
            So funktioniert&rsquo;s
          </h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Auswählen', desc: 'Stöbere durch das wöchentliche Sortiment und wähle deine Lieblingsbackwaren aus.' },
              { step: '2', title: 'Vorbestellen', desc: 'Ich backe nach dem „No Waste"-Prinzip: bestelle vorab online. Der Bestellschluss ist Montag- bzw. Donnerstagabend um 22:00. Bezahle bequem per Karte, Apple Pay oder Google Pay.' },
              { step: '3', title: 'Abholen', desc: 'Du bekommst eine E-Mail, sobald dein Brot bereitliegt – spätestens um 14:00 Uhr. Abholung an der Waldstraße 1 in Stockdorf, 5 Min. vom S-Bahnhof.' },
            ].map(item => (
              <div key={item.step} className="bg-white rounded-xl p-6 border border-smitten-cream">
                <div className="w-12 h-12 bg-smitten-primary text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto">
                  {item.step}
                </div>
                <h3 className="mt-4 font-display text-lg text-smitten-text font-bold">{item.title}</h3>
                <p className="mt-2 text-sm text-smitten-text/60">{item.desc}</p>
              </div>
            ))}
          </div>
          <Link
            href="/how-it-works"
            className="mt-8 inline-block text-sm text-smitten-primary hover:underline"
          >
            Mehr zum Ablauf →
          </Link>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-smitten-text">
          Abonnement
        </h2>
        <p className="mt-4 text-smitten-text/70 leading-relaxed">
          Du möchtest regelmäßig frisches Brot und Gebäck? Mit dem Abo-Service
          kannst du wöchentlich wiederkehrende Bestellungen aufgeben. Wähle deine
          Produkte aus, lege den Abholtag fest und ich backe jede Woche für dich.
          Du kannst jederzeit pausieren oder kündigen.
        </p>
        <Link
          href="/subscriptions"
          className="mt-6 inline-block bg-smitten-accent text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors"
        >
          Mehr erfahren
        </Link>
      </section>
    </div>
  );
}
