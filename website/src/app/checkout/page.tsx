'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/types';
import { getNextPickup } from '@/lib/pickup';
import { supabase } from '@/lib/supabase';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import Link from 'next/link';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface DiscountInfo {
  id: string;
  code: string;
  description: string;
  type: 'percentage' | 'fixed';
  value: number;
}

function PaymentForm({
  clientSecret,
  onSuccess,
  onBack,
}: {
  clientSecret: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) {
      setError('Zahlungssystem wird noch geladen. Bitte versuche es erneut.');
      setProcessing(false);
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const { error: submitError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/checkout/success',
          payment_method_data: {
            billing_details: {
              address: { country: 'DE' },
            },
          },
        },
        redirect: 'if_required',
      });

      if (submitError) {
        setError(submitError.message || 'Zahlung fehlgeschlagen.');
        setProcessing(false);
      } else {
        onSuccess();
      }
    } catch (err) {
      setError('Zahlung konnte nicht verarbeitet werden. Bitte versuche es erneut.');
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div className="bg-white rounded-xl border border-smitten-cream p-4">
        <h3 className="text-sm font-medium text-smitten-text mb-3">Zahlungsdaten</h3>
        <PaymentElement
          options={{
            fields: {
              billingDetails: {
                address: {
                  country: 'never',
                },
              },
            },
            defaultValues: {
              billingDetails: {
                name: '',
                address: { country: 'DE' },
              },
            },
          }}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={processing}
          className="flex-1 border border-smitten-cream text-smitten-text py-3 rounded-full font-medium hover:bg-smitten-cream transition-colors disabled:opacity-50"
        >
          Zurück
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="flex-1 bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors disabled:opacity-50"
        >
          {processing ? 'Wird verarbeitet...' : 'Bezahlen'}
        </button>
      </div>
    </form>
  );
}

function CheckoutForm() {
  const { state, totalCents, clearCart, addItem: cartAddItem, removeItem, updateQuantity } = useCart();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [name, setName] = useState(searchParams.get('name') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // Pickup day/date is derived from the order cutoff (not chosen by the customer).
  // Computed on the client after mount to avoid an SSR/hydration timezone mismatch.
  const [pickupLine, setPickupLine] = useState('');

  // Discount state
  const [discountCode, setDiscountCode] = useState('');
  const [discountValidating, setDiscountValidating] = useState(false);
  const [discountInfo, setDiscountInfo] = useState<DiscountInfo | null>(null);
  const [discountCents, setDiscountCents] = useState(0);
  const [discountError, setDiscountError] = useState('');

  // Pre-fill for logged-in users
  useEffect(() => {
    async function loadProfile() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setEmail(session.user.email || '');
        const { data: customer } = await supabase
          .from('customers').select('name').eq('id', session.user.id).single();
        if (customer?.name) setName(customer.name);
      }
    }
    loadProfile();
  }, []);

  useEffect(() => {
    const p = getNextPickup();
    setPickupLine(`Abholung: ${p.label} · ${p.cutoffLabel}`);
  }, []);

  const totalAfterDiscount = Math.max(0, totalCents - discountCents);

  async function handleApplyDiscount() {
    if (!discountCode.trim()) return;
    setDiscountValidating(true);
    setDiscountError('');
    setDiscountInfo(null);
    setDiscountCents(0);

    try {
      const response = await fetch('/api/validate-discount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: discountCode.trim(),
          email,
          items: state.items.map(item => ({
            price_cents: item.priceCents,
            quantity: item.quantity,
          })),
          fulfillment_date: getNextPickup().date,
        }),
      });

      const data = await response.json();

      if (!data.valid) {
        setDiscountError(data.error || 'Rabattcode ungültig.');
        return;
      }

      setDiscountInfo(data.discount);
      setDiscountCents(data.discountCents);
    } catch (err) {
      setDiscountError('Fehler bei der Rabattprüfung.');
    } finally {
      setDiscountValidating(false);
    }
  }

  function handleRemoveDiscount() {
    setDiscountCode('');
    setDiscountInfo(null);
    setDiscountCents(0);
    setDiscountError('');
  }

  async function handleStartPayment(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // For logged-in users: check email is confirmed
      if (session?.user && !session.user.email_confirmed_at) {
        throw new Error('Bitte bestätige zuerst deine E-Mail-Adresse. Wir haben dir einen Bestätigungslink gesendet.');
      }

      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: state.items.map(item => ({
            product_id: item.productId,
            price_cents: item.priceCents,
            quantity: item.quantity,
          })),
          pickup_location_id: state.pickupLocationId,
          fulfillment_date: getNextPickup().date,
          customer_email: session?.user?.email || email,
          customer_name: session?.user?.user_metadata?.full_name || name,
          customer_id: session?.user?.id || null,
          discount_code: discountInfo?.code || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Payment failed');

      setClientSecret(data.clientSecret);
      setStep('payment');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentSuccess() {
    clearCart();
    setStep('success');
  }

  function handleBack() {
    setStep('form');
    setError('');
  }

  if (state.items.length === 0 && step !== 'success') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Kasse</h1>
        <p className="mt-4 text-smitten-text/60">Dein Warenkorb ist leer.</p>
        <Link href="/products" className="mt-6 inline-block bg-smitten-primary text-white px-6 py-2 rounded-full text-sm">
          Zum Sortiment
        </Link>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-2xl text-green-600">
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-display font-bold text-smitten-text">Bestellung erfolgreich!</h1>
        <p className="mt-2 text-smitten-text/60">
          Vielen Dank für deine Bestellung! Deine Zahlung ist eingegangen.
        </p>
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-left">
          <p className="text-xs text-amber-700 font-medium uppercase tracking-wider">Wichtige Information</p>
          <p className="mt-1 text-sm text-amber-800">
            Deine Bestellnummer und die Rechnung erhältst du in Kürze per E-Mail.
          </p>
          <p className="mt-1 text-xs text-amber-700/70">
            Bitte nenne deinen Namen und die Bestellnummer bei der Abholung.
          </p>
        </div>
        <Link
          href="/products"
          className="mt-8 inline-block bg-smitten-primary text-white px-6 py-2 rounded-full text-sm"
        >
          Weiter einkaufen
        </Link>
      </div>
    );
  }

  if (step === 'payment' && clientSecret) {
    const options: StripeElementsOptions = {
      clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#f8120e',
          colorBackground: '#ffffff',
          colorText: '#1A1A1A',
          fontFamily: 'Inter, system-ui, sans-serif',
          borderRadius: '8px',
        },
      },
    };

    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Kasse</h1>

        <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-4">
          <h2 className="font-medium text-smitten-text">Bestellübersicht</h2>
          <div className="mt-3 space-y-2">
            {state.items.map(item => (
              <div key={item.productId} className="flex justify-between text-sm">
                <span>{item.quantity}× {item.name}</span>
                <span className="text-smitten-accent">{formatPrice(item.priceCents * item.quantity)}</span>
              </div>
            ))}
          </div>
          {pickupLine && (
            <p className="mt-3 text-sm text-smitten-text/70">{pickupLine}</p>
          )}
          {discountCents > 0 && (
            <div className="mt-2 flex justify-between text-sm text-green-600">
              <span>Rabatt ({discountInfo?.code})</span>
              <span>-{formatPrice(discountCents)}</span>
            </div>
          )}
          <div className="mt-2 pt-3 border-t border-smitten-cream flex justify-between font-bold">
            <span className="text-smitten-text">Gesamtsumme</span>
            <span className="text-smitten-accent">{formatPrice(totalAfterDiscount)}</span>
          </div>
        </div>

        <Elements stripe={stripePromise} options={options}>
          <PaymentForm clientSecret={clientSecret} onSuccess={handlePaymentSuccess} onBack={handleBack} />
        </Elements>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-display font-bold text-smitten-text">Kasse</h1>

      <div className="mt-6 bg-white rounded-xl border border-smitten-cream p-4">
        <h2 className="font-medium text-smitten-text">Bestellübersicht</h2>
        <div className="mt-3 space-y-2">
          {state.items.map(item => (
            <div key={item.productId} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (item.quantity <= 1) {
                      removeItem(item.productId);
                    } else {
                      updateQuantity(item.productId, item.quantity - 1);
                    }
                  }}
                  className="w-6 h-6 rounded-full border border-smitten-cream flex items-center justify-center text-smitten-text/50 hover:border-smitten-text/30 transition-colors text-xs"
                >
                  −
                </button>
                <span className="w-6 text-center font-medium">{item.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  className="w-6 h-6 rounded-full border border-smitten-cream flex items-center justify-center text-smitten-text/50 hover:border-smitten-text/30 transition-colors text-xs"
                >
                  +
                </button>
                <span className="ml-1">{item.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-smitten-accent">{formatPrice(item.priceCents * item.quantity)}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item.productId)}
                  className="text-xs text-smitten-text/30 hover:text-red-500 transition-colors"
                  title="Entfernen"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        {pickupLine && (
          <p className="mt-3 text-sm text-smitten-text/70">{pickupLine}</p>
        )}
        {(() => {
          const netTotal = Math.round(totalCents / 1.07);
          const vatTotal = totalCents - netTotal;
          return (
            <div className="mt-1 space-y-1 text-xs text-smitten-text/60">
              <div className="flex justify-between">
                <span>Zwischensumme (netto)</span>
                <span>{formatPrice(netTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>MwSt. 7%</span>
                <span>{formatPrice(vatTotal)}</span>
              </div>
            </div>
          );
        })()}

        {discountCents > 0 && (
          <div className="mt-2 flex justify-between text-sm text-green-600">
            <span>Rabatt ({discountInfo?.code})</span>
            <span>-{formatPrice(discountCents)}</span>
          </div>
        )}

        <div className="mt-2 pt-3 border-t border-smitten-cream flex justify-between font-bold">
          <span className="text-smitten-text">Gesamtsumme (brutto)</span>
          <span className="text-smitten-accent">
            {discountCents > 0 ? formatPrice(totalAfterDiscount) : formatPrice(totalCents)}
          </span>
        </div>
      </div>

      {/* Discount code input */}
      <div className="mt-4 bg-white rounded-xl border border-smitten-cream p-4">
        <h3 className="text-sm font-medium text-smitten-text">Rabattcode</h3>
        {discountInfo ? (
          <div className="mt-2 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-green-700">
                Code angewendet: {discountInfo.code}
              </span>
              <span className="text-xs text-smitten-text/60 ml-2">
                {discountInfo.type === 'percentage'
                  ? `${discountInfo.value}% Rabatt`
                  : `${formatPrice(discountInfo.value)} Rabatt`}
              </span>
            </div>
            <button
              onClick={handleRemoveDiscount}
              className="text-xs text-red-600 hover:text-red-700 transition-colors"
            >
              Entfernen
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={discountCode}
              onChange={e => setDiscountCode(e.target.value.toUpperCase())}
              placeholder="Code eingeben"
              className="flex-1 rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyDiscount(); } }}
            />
            <button
              type="button"
              onClick={handleApplyDiscount}
              disabled={discountValidating || !discountCode.trim()}
              className="px-4 py-2 bg-smitten-accent text-white text-sm rounded-lg hover:bg-smitten-accent/90 transition-colors disabled:opacity-50"
            >
              {discountValidating ? '...' : 'Anwenden'}
            </button>
          </div>
        )}
        {discountError && (
          <p className="mt-1.5 text-xs text-red-600">{discountError}</p>
        )}
      </div>

      <form onSubmit={handleStartPayment} className="mt-6 space-y-4">
        {!searchParams.get('name') && (
          <>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white"
              />
            </div>
          </>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Wird verarbeitet...' : `€${(totalAfterDiscount / 100).toFixed(2)} bezahlen`}
        </button>

        <p className="text-xs text-center text-smitten-text/40">
          Deine Zahlungsdaten werden sicher über Stripe verarbeitet.
        </p>
      </form>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-4 py-12 text-center text-smitten-text/60">Lädt...</div>}>
      <CheckoutForm />
    </Suspense>
  );
}
