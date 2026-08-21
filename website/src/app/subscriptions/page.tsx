'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatPrice } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface SubItem {
  id: string;
  product_id: string;
  quantity: number;
  products?: { name: string; price_cents: number };
}

interface Subscription {
  id: string;
  status: string;
  paused_from: string | null;
  paused_until: string | null;
  created_at: string;
  pickup_location_id: string;
  pickup_day: string | null;
  pickup_locations?: { name: string; address: string };
  subscription_items?: SubItem[];
}

const statusLabels: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  cancellation_pending: 'Kündigung läuft',
  cancelled: 'Gekündigt',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  cancellation_pending: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

export default function SubscriptionsPage() {
  const [user, setUser] = useState<unknown>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Pause state
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [pauseFrom, setPauseFrom] = useState('');
  const [pauseUntil, setPauseUntil] = useState('');
  const [pauseError, setPauseError] = useState('');

  // Cancel state
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    // Check for return from Stripe setup (3D Secure redirect)
    const params = new URLSearchParams(window.location.search);
    const setupSecret = params.get('setup_intent_client_secret');
    if (setupSecret) {
      handleStripeReturn(setupSecret);
    }
    loadSubscriptions();
  }, []);

  async function loadSubscriptions() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user || null);
    if (session?.user) {
      // Fetch subscriptions with items + product names + pickup locations
      const { data } = await supabase
        .from('subscriptions')
        .select('*, subscription_items(*, products(name, price_cents)), pickup_locations(name, address)')
        .eq('customer_id', session.user.id)
        .neq('status', 'cancelled') // hide fully-cancelled abos (cancellation_pending still shows)
        .order('created_at', { ascending: false });
      if (data) setSubscriptions(data as unknown as Subscription[]);
    }
    setLoading(false);
  }

  async function handleStripeReturn(setupSecret: string) {
    // Clean URL params to prevent re-trigger on reload
    window.history.replaceState({}, '', '/subscriptions');
    
    const stored = sessionStorage.getItem('pending_subscription');
    if (!stored) return;
    sessionStorage.removeItem('pending_subscription');

    const stripe = await stripePromise;
    if (!stripe) return;

    const { setupIntent } = await stripe.retrieveSetupIntent(setupSecret);
    if (setupIntent?.status !== 'succeeded') return;

    // Stripe setup succeeded — create the subscription
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const pending = JSON.parse(stored);
    const { data: sub } = await supabase.from('subscriptions').insert({
      customer_id: session.user.id,
      pickup_location_id: pending.pickupLocationId,
      pickup_day: pending.pickupDay ?? 'wednesday',
      status: 'active',
      stripe_setup_intent_id: setupIntent.id,
    }).select().single();

    if (sub) {
      for (const item of pending.items) {
        await supabase.from('subscription_items').insert({
          subscription_id: sub.id,
          product_id: item.productId,
          quantity: item.quantity,
        });
      }
      // Reload to show the new subscription
      loadSubscriptions();
    }
  }

  async function handlePause(subId: string) {
    if (!pauseFrom || !pauseUntil) return;
    if (new Date(pauseUntil) <= new Date(pauseFrom)) {
      setPauseError('Das Pause-Ende muss nach dem Pause-Beginn liegen.');
      return;
    }
    setPauseError('');
    setPausingId(subId);
    await supabase
      .from('subscriptions')
      .update({
        status: 'paused',
        paused_from: pauseFrom,
        paused_until: pauseUntil,
      })
      .eq('id', subId);
    setPausingId(null);
    setPauseFrom('');
    setPauseUntil('');
    loadSubscriptions();
  }

  async function handleResume(subId: string) {
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        paused_from: null,
        paused_until: null,
      })
      .eq('id', subId);
    loadSubscriptions();
  }

  async function handleCancel(subId: string) {
    if (!confirm('Möchtest du dieses Abo kündigen? Bereits bezahlte Bestellungen bleiben bestehen.')) return;
    setCancellingId(subId);
    await supabase
      .from('subscriptions')
      .update({ status: 'cancellation_pending' })
      .eq('id', subId);
    setCancellingId(null);
    loadSubscriptions();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">Meine Abos</h1>

      {loading ? (
        <p className="mt-8 text-center text-smitten-text/40">Lädt...</p>
      ) : !user ? (
        /* Not logged in — show info page with CTA */
        <>
          <section className="mt-8">
            <h2 className="text-xl font-display font-bold text-smitten-text">Nie wieder Brot verpassen</h2>
            <p className="mt-3 text-smitten-text leading-relaxed">
              Weniger To-do für dich, mehr Zeit für gutes Brot. Mit dem Brot-Abo musst du nie wieder daran denken, rechtzeitig zu bestellen!
            </p>
          </section>

          <section className="mt-8 bg-smitten-cream rounded-xl p-6">
            <h3 className="font-display text-lg font-bold text-smitten-text mb-3">So funktioniert dein Abo</h3>
            <ul className="space-y-3 text-sm text-smitten-text">
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">📧</span>
                <span>Am Bestelltag bekommst du mittags eine <strong>Erinnerung per E-Mail</strong> (oder Push-Benachrichtigung, wenn du die App nutzt).</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">🔄</span>
                <span>Wenn mit deiner Bestellung alles in Ordnung ist, <strong>musst du nichts tun</strong>. Die Bestellung wird automatisch um <strong>20:00 Uhr</strong> aufgegeben und der Betrag abgebucht.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">✏️</span>
                <span>Möchtest du Produkte ändern, die Menge anpassen oder das Abo pausieren? Das kannst du <strong>bis 20:00 Uhr</strong> ganz einfach in deinem Konto erledigen.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-smitten-primary font-bold shrink-0">⏰</span>
                <span>Nach 20:00 Uhr hast du noch bis <strong>22:00 Uhr</strong> Zeit, die Bestellung zu stornieren. Danach ist eine Stornierung nicht mehr möglich und es wird für dich gebacken.</span>
              </li>
            </ul>
          </section>
          <button onClick={() => router.push('/login?redirect=/subscriptions')}
            className="mt-8 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
            Abo einrichten
          </button>
        </>
      ) : subscriptions.length === 0 ? (
        /* Logged in but no subscriptions */
        <>
          <p className="mt-6 text-smitten-text">Du hast noch kein Abo eingerichtet.</p>
          <Link href="/subscriptions/create"
            className="mt-4 inline-block bg-smitten-accent text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
            Abo einrichten
          </Link>
        </>
      ) : (
        /* List subscriptions */
        <div className="mt-6 space-y-4">
          {subscriptions.map(sub => {
            const items = sub.subscription_items || [];
            const totalCents = items.reduce((sum, i) => sum + (i.products?.price_cents || 0) * i.quantity, 0);
            const isPaused = sub.status === 'paused' && sub.paused_until;
            const pauseEnds = sub.paused_until ? new Date(sub.paused_until + 'T23:59:59') : null;
            const isPauseExpired = pauseEnds && pauseEnds < new Date();

            return (
              <div key={sub.id} className="bg-white rounded-xl border border-smitten-cream p-5">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[sub.status] || 'bg-gray-100 text-gray-500'}`}>
                      {statusLabels[sub.status] || sub.status}
                    </span>
                    {(sub.status === 'active' || sub.status === 'paused') && (
                      <span className="ml-2 text-xs text-smitten-text/40">
                        Abholtag: <strong>{sub.pickup_day === 'both' ? 'Mittwoch + Samstag' : sub.pickup_day === 'saturday' ? 'Samstag' : 'Mittwoch'}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-smitten-text/40">
                    {new Date(sub.created_at).toLocaleDateString('de-DE')}
                  </p>
                </div>

                {/* Items */}
                <div className="mt-3 space-y-1">
                  {items.map(item => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-smitten-text">
                        {item.quantity}× {item.products?.name || 'Unbekannt'}
                      </span>
                      <span className="text-smitten-text">
                        {formatPrice((item.products?.price_cents || 0) * item.quantity)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-medium border-t border-smitten-cream pt-1 mt-1">
                    <span className="text-smitten-text">Wöchentlicher Preis</span>
                    <span className="text-smitten-text">{formatPrice(totalCents)}</span>
                  </div>
                </div>

                {/* Pickup location */}
                {sub.pickup_locations && (
                  <p className="mt-2 text-xs text-smitten-text/40">
                    Abholung: {sub.pickup_locations.name}
                  </p>
                )}

                {/* Pause info */}
                {isPaused && sub.paused_from && (
                  <p className="mt-2 text-sm text-amber-600">
                    Pausiert von {new Date(sub.paused_from + 'T00:00:00').toLocaleDateString('de-DE')} bis {new Date(sub.paused_until! + 'T00:00:00').toLocaleDateString('de-DE')}
                    {isPauseExpired && (
                      <button onClick={() => handleResume(sub.id)}
                        className="ml-2 text-smitten-primary underline text-xs">
                        Jetzt reaktivieren
                      </button>
                    )}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(sub.status === 'active' || sub.status === 'paused') && (
                    <Link href={`/subscriptions/edit/${sub.id}`}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                      Bearbeiten
                    </Link>
                  )}
                  {(sub.status === 'active' || isPauseExpired) && (
                    <button onClick={() => { setPausingId(sub.id); setPauseFrom(''); setPauseUntil(''); }}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                      Pausieren
                    </button>
                  )}
                  {isPaused && !isPauseExpired && (
                    <button onClick={() => handleResume(sub.id)}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-green-600 hover:border-green-300 transition-colors">
                      Reaktivieren
                    </button>
                  )}
                  {sub.status === 'active' && (
                    <button onClick={() => handleCancel(sub.id)} disabled={cancellingId === sub.id}
                      className="text-xs border border-red-200 px-3 py-1.5 rounded-full text-red-500 hover:border-red-300 transition-colors disabled:opacity-50">
                      {cancellingId === sub.id ? 'Wird gekündigt...' : 'Kündigen'}
                    </button>
                  )}
                  {sub.status === 'cancellation_pending' && (
                    <span className="text-xs text-orange-500">Kündigung wird beim nächsten Durchlauf bearbeitet</span>
                  )}
                </div>

                {/* Pause form inline */}
                {pausingId === sub.id && (
                  <div className="mt-4 p-4 bg-smitten-cream rounded-xl space-y-3">
                    <p className="text-sm font-medium text-smitten-text">Abo pausieren</p>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-smitten-text mb-1">Von</label>
                        <input type="date" value={pauseFrom} onChange={e => setPauseFrom(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full rounded-lg border border-smitten-cream px-3 py-1.5 text-sm bg-white" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-smitten-text mb-1">Bis</label>
                        <input type="date" value={pauseUntil} onChange={e => setPauseUntil(e.target.value)}
                          min={pauseFrom || new Date().toISOString().split('T')[0]}
                          className="w-full rounded-lg border border-smitten-cream px-3 py-1.5 text-sm bg-white" />
                      </div>
                    </div>
                    {pauseError && <p className="text-xs text-red-500">{pauseError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => setPausingId(null)}
                        className="px-4 py-1.5 text-xs border border-smitten-cream rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                        Abbrechen
                      </button>
                      <button onClick={() => handlePause(sub.id)} disabled={!pauseFrom || !pauseUntil}
                        className="px-4 py-1.5 text-xs bg-smitten-primary text-white rounded-full hover:bg-smitten-primary/90 disabled:opacity-50 transition-colors">
                        Pause speichern
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <Link href="/subscriptions/create"
            className="block text-center mt-4 bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
            Weiteres Abo einrichten
          </Link>
        </div>
      )}
    </div>
  );
}
