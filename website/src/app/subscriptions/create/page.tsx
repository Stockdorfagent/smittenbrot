'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Product, PickupLocation, formatPrice } from '@/lib/types';
import { User } from '@supabase/supabase-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import Link from 'next/link';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface SubItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

type Step = 'products' | 'overview' | 'account';

function SubscriptionCreateForm() {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const [step, setStep] = useState<Step>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [weekCycle, setWeekCycle] = useState<'A' | 'B'>('A');
  const [items, setItems] = useState<SubItem[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [pickupDay, setPickupDay] = useState<'wednesday' | 'saturday'>('wednesday');
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showStripe, setShowStripe] = useState(false);
  const [stripeError, setStripeError] = useState('');
  const [stripeLoading, setStripeLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const pickup = getNextPickup();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
    });
    fetchData();
  }, []);

  async function fetchData() {
    const { data: cycleData } = await supabase
      .from('week_cycle').select('current_week').order('created_at', { ascending: false }).limit(1).single();
    if (cycleData) setWeekCycle(cycleData.current_week);

    const { data: prodData } = await supabase
      .from('products').select('*').eq('active', true).order('sort_order', { ascending: true });
    if (prodData) {
      const filtered = prodData.filter(p => {
        if (p.cycle === 'permanent') return true;
        const cycle = cycleData?.current_week ?? 'A';
        if (p.cycle === 'week_a') return cycle === 'A';
        if (p.cycle === 'week_b') return cycle === 'B';
        return false;
      });
      setProducts(filtered);
    }

    const { data: locData } = await supabase
      .from('pickup_locations').select('*').eq('active', true).order('sort_order', { ascending: true });
    if (locData) {
      setLocations(locData);
      if (locData.length > 0 && !selectedLocation) setSelectedLocation(locData[0].id);
    }
  }

  function toggleItem(product: Product) {
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) return prev.filter(i => i.productId !== product.id);
      return [...prev, { productId: product.id, name: product.name, priceCents: product.price_cents, quantity: 1 }];
    });
  }

  function updateQty(productId: string, qty: number) {
    if (qty < 1) {
      setItems(prev => prev.filter(i => i.productId !== productId));
      return;
    }
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  }

  const totalCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

  async function handleCreateAccount() {
    setLoading(true);
    setError('');
    const { error: signUpError, data } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    });
    if (signUpError) { setError(signUpError.message); setLoading(false); return; }

    // Create customer record — use user from signUp response directly
    if (data?.user) {
      await supabase.from('customers').upsert({
        id: data.user.id,
        email,
        name,
        preferred_pickup_location_id: selectedLocation,
      }, { onConflict: 'id' });
      setUser(data.user);
    } else {
      // Email confirmation enabled — user needs to confirm first
      setError('Registrierung erfolgreich! Wir haben dir eine Bestätigungs-E-Mail gesendet. Bitte bestätige deine E-Mail, um fortzufahren.');
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  async function handleLogin() {
    setLoading(true);
    setError('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) { setError(loginError.message); setLoading(false); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) setUser(session.user);
    setLoading(false);
  }

  async function handleSetupPayment() {
    setStripeLoading(true);
    setStripeError('');
    try {
      const email = (user as User).email;
      
      // Save subscription data in case of 3D Secure redirect
      sessionStorage.setItem('pending_subscription', JSON.stringify({
        items,
        pickupLocationId: selectedLocation,
        pickupDay,
      }));
      
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/create-setup-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setStripeError(data.error || 'Fehler'); setStripeLoading(false); return; }
      setClientSecret(data.clientSecret);
      setShowStripe(true);
    } catch (e) {
      setStripeError('Verbindungsfehler');
    }
    setStripeLoading(false);
  }

  const [clientSecret, setClientSecret] = useState('');

  async function handleStripeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setStripeLoading(true);
    setStripeError('');

    const { error: submitError } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/subscriptions`,
      },
      redirect: 'if_required',
    });

    if (submitError) {
      setStripeError(submitError.message || 'Fehler bei der Zahlungsmethode');
      setStripeLoading(false);
      return;
    }

    // Payment method saved - now create the subscription
    await handleSubmitSubscription();
    setStripeLoading(false);
  }

  async function handleSubmitSubscription() {
    if (!user || items.length === 0) return;
    setSubmitting(true);
    setError('');

    const { data: newSub, error: subError } = await supabase.from('subscriptions').insert({
      customer_id: user.id,
      pickup_location_id: selectedLocation,
      status: 'active',
    }).select().single();

    if (subError || !newSub) { setError(subError?.message || 'Fehler'); setSubmitting(false); return; }

    // Insert subscription items
    for (const item of items) {
      await supabase.from('subscription_items').insert({
        subscription_id: newSub.id,
        product_id: item.productId,
        quantity: item.quantity,
      });
    }

    setSuccess(true);
    setSubmitting(false);
  }

  if (success) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-2xl text-green-600">✓</div>
        <h1 className="mt-4 text-2xl font-display font-bold text-smitten-text">Abo eingerichtet!</h1>
        <p className="mt-2 text-smitten-text/60">
          Dein Abo ist aktiv. Du bekommst vor jedem Bestelltag eine Erinnerung.
        </p>
        <Link href="/subscriptions" className="mt-6 inline-block bg-smitten-accent text-white px-6 py-2 rounded-full text-sm">
          Zu meinen Abos
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-10">
        {(['products', 'overview', 'account'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'bg-smitten-primary text-white' : 
              ['products', 'overview', 'account'].indexOf(step) >= i ? 'bg-smitten-primary/20 text-smitten-primary' : 'bg-smitten-cream text-smitten-text/40'
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${step === s ? 'text-smitten-text font-medium' : 'text-smitten-text/40'}`}>
              {s === 'products' ? 'Produkte' : s === 'overview' ? 'Übersicht' : 'Konto'}
            </span>
            {i < 2 && <span className="text-smitten-text/20 mx-1">→</span>}
          </div>
        ))}
      </div>

      <h1 className="text-3xl font-display font-bold text-smitten-text text-center mb-2">
        {step === 'products' ? 'Abo zusammenstellen' : step === 'overview' ? 'Übersicht' : 'Konto für dein Abo'}
      </h1>
      {step === 'products' && (
        <p className="text-center text-smitten-text/60 mb-8">
          Wähle die Produkte aus, die du regelmäßig erhalten möchtest.
        </p>
      )}

      {/* Step 1: Product selection */}
      {step === 'products' && (
        <>
          <div className="mb-4 text-sm text-smitten-text/60">
            Nächste Abholung: <strong>{pickup.label}</strong> ({pickup.cutoffLabel})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map(product => {
              const selected = items.find(i => i.productId === product.id);
              return (
                <div key={product.id} className={`bg-white rounded-xl p-4 border-2 cursor-pointer transition-all ${
                  selected ? 'border-smitten-primary' : 'border-smitten-cream hover:border-smitten-primary/30'
                }`}
                onClick={() => toggleItem(product)}>
                  {product.cover_image_url ? (
                    <img src={product.cover_image_url} alt={product.name} className="w-full h-32 object-cover rounded-lg mb-3" />
                  ) : (
                    <div className="w-full h-32 bg-smitten-cream rounded-lg flex items-center justify-center text-3xl font-display text-smitten-secondary mb-3">
                      {product.name.charAt(0)}
                    </div>
                  )}
                  <div className="flex items-start justify-between">
                    <h3 className="font-display font-bold text-smitten-text">{product.name}</h3>
                    <span className="text-smitten-accent font-bold text-sm">{formatPrice(product.price_cents)}</span>
                  </div>
                  {selected && (
                    <div className="mt-3 flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => updateQty(product.id, selected.quantity - 1)}
                        className="w-8 h-8 rounded-full border border-smitten-cream flex items-center justify-center text-sm hover:bg-smitten-cream">−</button>
                      <span className="text-sm font-medium w-6 text-center">{selected.quantity}</span>
                      <button onClick={() => updateQty(product.id, selected.quantity + 1)}
                        className="w-8 h-8 rounded-full border border-smitten-cream flex items-center justify-center text-sm hover:bg-smitten-cream">+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-8 text-center">
            <button onClick={() => setStep('overview')} disabled={items.length === 0}
              className="bg-smitten-primary text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-primary/90 disabled:opacity-40 transition-colors">
              Weiter ({items.length} Produkte)
            </button>
          </div>
        </>
      )}

      {/* Step 2: Overview */}
      {step === 'overview' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl border border-smitten-cream p-6">
            <h2 className="font-display font-bold text-smitten-text mb-4">Deine Abo-Produkte</h2>
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.productId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-smitten-accent font-bold">{item.quantity}×</span>
                    <span className="text-smitten-text">{item.name}</span>
                  </div>
                  <span className="text-smitten-accent">{formatPrice(item.priceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-smitten-cream flex justify-between font-bold">
              <span className="text-smitten-text">Wöchentliche Gesamtsumme</span>
              <span className="text-smitten-accent">{formatPrice(totalCents)}</span>
            </div>
          </div>

          <div className="mt-6 bg-smitten-cream rounded-xl p-6">
            <h3 className="font-display font-bold text-smitten-text mb-3">So funktioniert dein Abo</h3>
            <ul className="space-y-3 text-sm text-smitten-text/70">
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">📧</span>
                <span>Am Bestelltag bekommst du mittags eine <strong>Erinnerung per E-Mail</strong> (und Push-Benachrichtigung, wenn du die App nutzt).</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">🔄</span>
                <span>Wenn mit deiner Bestellung alles in Ordnung ist, <strong>musst du nichts tun</strong>. Die Bestellung wird automatisch um <strong>20:00 Uhr</strong> aufgegeben und der Betrag abgebucht.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">✏️</span>
                <span>Möchtest du Produkte ändern, die Menge anpassen oder die Lieferung pausieren? Das kannst du <strong>bis 20:00 Uhr</strong> ganz einfach in deinem Konto erledigen.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">⏰</span>
                <span>Nach 20:00 Uhr hast du noch bis <strong>22:00 Uhr</strong> Zeit, die Bestellung zu stornieren – danach wird für dich gebacken.</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-smitten-text/70 mb-2">Abholtag</label>
              <div className="flex gap-2">
                {(['wednesday', 'saturday'] as const).map(d => (
                  <button key={d}
                    onClick={() => setPickupDay(d)}
                    className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                      pickupDay === d
                        ? 'bg-smitten-primary text-white'
                        : 'bg-smitten-cream text-smitten-text/70 hover:bg-smitten-primary/10'
                    }`}>
                    {d === 'wednesday' ? 'Mittwoch' : 'Samstag'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70 mb-2">Abholort</label>
            <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}
              className="w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white">
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name} – {loc.address}</option>
              ))}
            </select>
          </div>
          </div>

          <div className="mt-8 flex justify-between">
            <button onClick={() => setStep('products')} className="text-smitten-secondary hover:underline text-sm">← Zurück</button>
            <button onClick={() => setStep('account')} disabled={!selectedLocation}
              className="bg-smitten-primary text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-primary/90 disabled:opacity-40 transition-colors">
              {user ? 'Abo bestätigen' : 'Weiter – Konto erforderlich'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Account / Confirmation */}
      {step === 'account' && !user && (
        <div className="max-w-md mx-auto">
          <p className="text-center text-smitten-text/60 mb-6">
            Für ein Abo benötigst du ein Konto. So kannst du jederzeit Pausen einlegen, Produkte ändern oder kündigen.
          </p>
          <div className="bg-white rounded-xl border border-smitten-cream p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">Passwort</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" required />
            </div>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
            <button onClick={handleCreateAccount} disabled={loading}
              className="w-full bg-smitten-primary text-white py-3 rounded-full font-medium hover:bg-smitten-primary/90 disabled:opacity-50">
              {loading ? 'Wird erstellt...' : 'Konto erstellen & Abo starten'}
            </button>
          </div>
          <p className="mt-4 text-center text-sm text-smitten-text/60">
            Bereits Kunde?{' '}
            <button onClick={() => {/* switch to login */ document.getElementById('login-form')?.scrollIntoView()}} className="text-smitten-primary hover:underline">
              Hier anmelden
            </button>
          </p>
          <div id="login-form" className="mt-6 bg-white rounded-xl border border-smitten-cream p-6 space-y-4">
            <h3 className="font-medium text-smitten-text">Anmelden</h3>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-smitten-text/70">Passwort</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white" />
            </div>
            <button onClick={handleLogin} disabled={loading}
              className="w-full border border-smitten-primary text-smitten-primary py-3 rounded-full font-medium hover:bg-smitten-primary/5 disabled:opacity-50">
              {loading ? 'Wird verarbeitet...' : 'Anmelden'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirmation (already logged in) */}
      {step === 'account' && user && !showStripe && (
        <div className="max-w-md mx-auto text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-2xl text-green-600">✓</div>
          <p className="mt-4 text-smitten-text/70 mb-6">
            Du bist angemeldet. Dein Abo wird eingerichtet, sobald du ein Zahlungsmittel hinterlegt hast.
          </p>
          <div className="bg-white rounded-xl border border-smitten-cream p-6">
            <p className="text-sm text-smitten-text/60 mb-4">
              Hinterlege jetzt deine Zahlungsdaten für die wöchentliche Abbuchung.
            </p>
            <button onClick={handleSetupPayment}
              className="w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
              Zahlungsdaten eingeben
            </button>
          </div>
          <div className="mt-6 flex justify-center gap-4">
            <button onClick={() => setStep('overview')} className="text-smitten-secondary hover:underline text-sm">← Zurück</button>
          </div>
          {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        </div>
      )}

      {/* Stripe payment element */}
      {step === 'account' && user && showStripe && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-xl border border-smitten-cream p-6">
            <h3 className="font-display font-bold text-smitten-text mb-4">Zahlungsmethode</h3>
            {stripe && elements && (
              <form onSubmit={handleStripeSubmit}>
                <PaymentElement />
                {stripeError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{stripeError}</div>
                )}
                <button type="submit" disabled={!stripe || stripeLoading}
                  className="mt-6 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 disabled:opacity-50 transition-colors">
                  {stripeLoading ? 'Wird verarbeitet...' : 'Zahlungsmethode speichern & Abo starten'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionCreatePage() {
  return (
    <Elements stripe={stripePromise}>
      <SubscriptionCreateForm />
    </Elements>
  );
}
function getNextPickup(): { label: string; cutoffLabel: string } {
  const now = new Date();
  const berlin = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const day = berlin.getDay();
  const hours = berlin.getHours();
  const minutes = berlin.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const cutoffMinutes = 22 * 60;
  if (day === 1 && totalMinutes < cutoffMinutes) return { label: 'Mittwoch', cutoffLabel: 'Bestellschluss: heute 22:00' };
  if ((day === 1 && totalMinutes >= cutoffMinutes) || day === 2 || day === 3) return { label: 'Samstag', cutoffLabel: 'Bestellschluss: Donnerstag 22:00' };
  if (day === 4 && totalMinutes < cutoffMinutes) return { label: 'Samstag', cutoffLabel: 'Bestellschluss: heute 22:00' };
  return { label: 'Mittwoch', cutoffLabel: 'Bestellschluss: Montag 22:00' };
}
