'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Product, formatPrice } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import { getNextPickup } from '@/lib/pickup';
import Link from 'next/link';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showWarning, setShowWarning] = useState(false);
  const [weekCycle, setWeekCycle] = useState<'A' | 'B'>('A');
  const [adding, setAdding] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const pickup = getNextPickup();

  useEffect(() => {
    async function fetchData() {
      const { data: productData } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      if (productData) {
        setProduct(productData);
        setSelectedImage(productData.cover_image_url || (productData.images?.[0] ?? null));
      }

      const { data: cycleData } = await supabase
        .from('week_cycle')
        .select('current_week')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (cycleData) setWeekCycle(cycleData.current_week);
    }
    fetchData();
  }, [id]);

  const handleQuantityChange = (val: number) => {
    if (val < 1) return;
    setQuantity(val);
    if (val > 10) setShowWarning(true);
    else setShowWarning(false);
  };

  const handleAddToCart = () => {
    if (!product) return;
    addItem({
      productId: product.id,
      name: product.name,
      priceCents: product.price_cents,
      quantity,
    });
    setAdding(true);
    setTimeout(() => {
      setAdding(false);
      router.push('/cart');
    }, 600);
  };

  if (!product) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center text-smitten-text/40">
        Produkt wird geladen...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/products" className="text-sm text-smitten-secondary hover:underline">
        ← Zurück zum Sortiment
      </Link>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <div className="w-full aspect-square bg-smitten-cream rounded-xl overflow-hidden">
            {selectedImage ? (
              <img
                src={selectedImage}
                alt={product.alt_text || product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl font-display text-smitten-secondary">
                {product.name.charAt(0)}
              </div>
            )}
          </div>

          {/* Image gallery */}
          {product.images && product.images.length > 1 && (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
              {product.images.map((imgUrl, i) => (
                <img
                  key={i}
                  src={imgUrl}
                  alt={`${product.alt_text || product.name} – Ansicht ${i + 1}`}
                  onClick={() => setSelectedImage(imgUrl)}
                  className={`w-24 h-24 rounded-lg object-cover border-2 cursor-pointer flex-shrink-0 transition-colors ${
                    selectedImage === imgUrl
                      ? 'border-smitten-primary'
                      : 'border-transparent hover:border-smitten-text/30'
                  }`}
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-3xl font-display font-bold text-smitten-text">
            {product.name}
          </h1>
          <p className="mt-2 text-smitten-accent text-2xl font-bold">
            {formatPrice(product.price_cents)}
          </p>
          <p className="text-xs text-smitten-text/40">inkl. 7 % MwSt.</p>

          <div className="mt-4">
            <p className="text-sm text-smitten-secondary">
              Jetzt bestellen für <strong className="text-smitten-text font-semibold">{pickup.label}</strong> · {pickup.cutoffLabel}
            </p>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleQuantityChange(quantity - 1)}
                className="w-10 h-10 rounded-full border border-smitten-cream flex items-center justify-center text-lg hover:bg-smitten-cream"
              >
                −
              </button>
              <span className="text-xl font-medium w-8 text-center">{quantity}</span>
              <button
                onClick={() => handleQuantityChange(quantity + 1)}
                className="w-10 h-10 rounded-full border border-smitten-cream flex items-center justify-center text-lg hover:bg-smitten-cream"
              >
                +
              </button>
            </div>
          </div>

          {showWarning && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              Du hast {quantity}× {product.name} ausgewählt. Ist das korrekt?
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setShowWarning(false)}
                  className="px-3 py-1 bg-amber-600 text-white rounded-full text-xs"
                >
                  Ja
                </button>
                <button
                  onClick={() => { setQuantity(1); setShowWarning(false); }}
                  className="px-3 py-1 border border-amber-300 rounded-full text-xs"
                >
                  Menge ändern
                </button>
              </div>
            </div>
          )}

          <button
            onClick={handleAddToCart}
            disabled={adding}
            className="mt-6 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors disabled:opacity-50"
          >
            {adding ? 'Wird hinzugefügt...' : 'In den Warenkorb'}
          </button>

          <hr className="my-8 border-smitten-cream" />

          {(() => {
            const desc = product.description ?? '';
            const blankIndex = desc.indexOf('\n\n');
            const mainDesc = blankIndex >= 0 ? desc.slice(0, blankIndex) : desc;
            const infoSection = blankIndex >= 0 ? desc.slice(blankIndex + 2) : '';
            return (
              <>
                {mainDesc && (
                  <p className="text-smitten-text leading-relaxed mb-4">{mainDesc}</p>
                )}
                {infoSection && (
                  <div className="text-smitten-text leading-relaxed whitespace-pre-line">
                    {infoSection.split('\n').map((line, i) => {
                      if (line.startsWith('Gewicht:') || line.startsWith('Zutaten:') || line.startsWith('Allergene:')) {
                        const [label, ...rest] = line.split(':');
                        return (
                          <p key={i} className="mb-0.5">
                            <strong>{label}:</strong>{rest.join(':')}
                          </p>
                        );
                      }
                      if (line.startsWith('In der gleichen Backstube')) {
                        return <p key={i} className="italic mb-0.5">{line}</p>;
                      }
                      if (line.trim() === '') {
                        return <div key={i} className="h-2" />;
                      }
                      return <p key={i} className="mb-0.5">{line}</p>;
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
