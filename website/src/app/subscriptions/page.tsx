'use client';

import { useEffect, useState } from 'react';
import { supabase, invokeEdgeFunction } from '@/lib/supabase';
import { berlinDatePlusDays, berlinTodayISO } from '@/lib/pickup';
import { formatPrice, type Subscription } from '@/lib/types';
import Link from 'next/link';
import AboExplainer from '@/components/AboExplainer';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

/**
 * Inline card-update form for a payment_failed Abo — the web counterpart of
 * the app's "Zahlungsmethode aktualisieren". Confirms the SetupIntent; the
 * parent then resumes the Abo through the engine (which regenerates the next
 * order). A 3D-Secure card redirects to /subscriptions and is finished by
 * handleStripeReturn via the pending_payment_update sessionStorage marker.
 */
function CardUpdateForm({
  subId,
  onDone,
  onCancel,
}: {
  subId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    // Marker for the redirect case — cleared again if no redirect happens.
    sessionStorage.setItem('pending_payment_update', JSON.stringify({ subId }));
    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/subscriptions` },
      redirect: 'if_required',
    });
    if (confirmError) {
      sessionStorage.removeItem('pending_payment_update');
      setError(confirmError.message || 'Fehler bei der Zahlungsmethode');
      setBusy(false);
      return;
    }
    sessionStorage.removeItem('pending_payment_update');
    await onDone();
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-4 p-4 bg-smitten-cream rounded-xl space-y-3">
      <p className="text-sm font-medium text-smitten-text">Neue Zahlungsmethode</p>
      <PaymentElement />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-1.5 text-xs border border-smitten-cream rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
          Abbrechen
        </button>
        <button type="submit" disabled={!stripe || busy}
          className="px-4 py-1.5 text-xs bg-smitten-primary text-white rounded-full hover:bg-smitten-primary/90 disabled:opacity-50 transition-colors">
          {busy ? 'Wird gespeichert...' : 'Speichern & Abo fortsetzen'}
        </button>
      </div>
    </form>
  );
}

interface SubItem {
  id: string;
  product_id: string;
  quantity: number;
  products?: { name: string; price_cents: number };
}

// The canonical row lives in lib/types — this page only adds the relations it
// joins in its select. (The DB also has paused_from, kept for history only:
// nothing reads or writes it any more; the engine sets just paused_until.)
interface SubscriptionRow extends Subscription {
  pickup_locations?: { name: string; address: string };
  subscription_items?: SubItem[];
}

const statusLabels: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  cancellation_pending: 'Kündigung läuft',
  cancelled: 'Gekündigt',
  payment_failed: 'Zahlung fehlgeschlagen',
};

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  cancellation_pending: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-500',
  payment_failed: 'bg-red-100 text-red-700',
};

export default function SubscriptionsPage() {
  const [user, setUser] = useState<unknown>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Pause state
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [pauseUntil, setPauseUntil] = useState('');
  const [pauseError, setPauseError] = useState('');
  const [resumeError, setResumeError] = useState<{ id: string; msg: string } | null>(null);
  // Only one engine action can be in flight; this is the sub it belongs to.
  // Pause, resume and cancel buttons all key their busy/disabled state off it.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Card update for a payment_failed Abo
  const [cardUpdate, setCardUpdate] = useState<{ subId: string; clientSecret: string } | null>(null);
  const [banner, setBanner] = useState('');

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
      if (data) setSubscriptions(data as unknown as SubscriptionRow[]);
    }
    setLoading(false);
  }

  async function handleStripeReturn(setupSecret: string) {
    // Clean URL params to prevent re-trigger on reload
    window.history.replaceState({}, '', '/subscriptions');

    // A card UPDATE that went through 3D-Secure lands here too.
    const pendingUpdate = sessionStorage.getItem('pending_payment_update');
    if (pendingUpdate) {
      sessionStorage.removeItem('pending_payment_update');
      const stripe = await stripePromise;
      if (!stripe) return;
      const { setupIntent } = await stripe.retrieveSetupIntent(setupSecret);
      if (setupIntent?.status !== 'succeeded') return;
      const { subId } = JSON.parse(pendingUpdate) as { subId: string };
      await finishCardUpdate(subId);
      return;
    }

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

  /**
   * Pause and resume MUST go through the engine, never straight into the table.
   *
   * A pause also has to delete the already-generated, not-yet-charged order for
   * the paused week; a resume has to regenerate it if the cutoff has not passed
   * yet. Writing `subscriptions` directly — which this page used to do — skipped
   * both. The orphaned order was never charged and never removed, so it kept
   * consuming that day's capacity, still turned up on the bake list, and still
   * showed on the customer's phone as a pickup that was coming. Resuming on the
   * web then produced the opposite: an active Abo and no bread that week.
   *
   * There is only one pause date, "bis". The old form also asked for a "von",
   * but the write set status='paused' immediately regardless of it and nothing
   * in the backend has ever read `paused_from` — so a customer choosing a start
   * a month out had their Abo paused on the spot. One date is the truth.
   */
  async function handlePause(subId: string) {
    if (!pauseUntil) return;
    // Berlin calendar date on both sides — the engine validates against its
    // todayInTz(), and toISOString() would be the UTC date, i.e. still
    // yesterday between midnight and ~02:00 Berlin time.
    if (pauseUntil <= berlinTodayISO()) {
      setPauseError('Das Pause-Ende muss in der Zukunft liegen.');
      return;
    }
    setPauseError('');
    setBusyId(subId);
    const res = await invokeEdgeFunction(
      'subscription-engine/pause',
      { subscription_id: subId, resume_date: pauseUntil },
      'Pausieren fehlgeschlagen. Bitte versuche es erneut.',
    );
    setBusyId(null);
    if (!res.ok) {
      setPauseError(res.message);
      return;
    }
    setPausingId(null);
    setPauseUntil('');
    loadSubscriptions();
  }

  async function handleResume(subId: string) {
    setResumeError(null);
    setBusyId(subId);
    const res = await invokeEdgeFunction(
      'subscription-engine/resume',
      { subscription_id: subId },
      'Fortsetzen fehlgeschlagen. Bitte versuche es erneut.',
    );
    setBusyId(null);
    if (!res.ok) {
      setResumeError({ id: subId, msg: res.message });
      return;
    }
    loadSubscriptions();
  }

  /** Fetch a SetupIntent and open the inline card form for this Abo. */
  async function startCardUpdate(subId: string) {
    setResumeError(null);
    setBanner('');
    setBusyId(subId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/create-setup-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.clientSecret) {
        setResumeError({ id: subId, msg: data.error ?? 'Zahlungsformular konnte nicht geladen werden.' });
        return;
      }
      setCardUpdate({ subId, clientSecret: data.clientSecret });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Card saved — reactivate through the engine, which also regenerates the
   * next order (the app's recovery flow does exactly the same).
   */
  async function finishCardUpdate(subId: string) {
    setCardUpdate(null);
    const res = await invokeEdgeFunction(
      'subscription-engine/resume',
      { subscription_id: subId },
      'Die Karte wurde gespeichert, aber das Abo konnte nicht fortgesetzt werden. Bitte versuche es erneut.',
    );
    if (!res.ok) {
      setResumeError({ id: subId, msg: res.message });
      return;
    }
    setBanner('Zahlungsmethode gespeichert — dein Abo läuft weiter.');
    loadSubscriptions();
  }

  async function handleCancel(subId: string) {
    if (!confirm('Möchtest du dieses Abo kündigen? Bereits bezahlte Bestellungen bleiben bestehen.')) return;
    setBusyId(subId);
    await supabase
      .from('subscriptions')
      .update({ status: 'cancellation_pending' })
      .eq('id', subId);
    setBusyId(null);
    loadSubscriptions();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">Meine Abos</h1>

      {loading ? (
        <p className="mt-8 text-center text-smitten-text/40">Lädt...</p>
      ) : !user ? (
        /* Not logged in — explanation + login CTA */
        <>
          <AboExplainer />
          <button onClick={() => router.push('/login?redirect=/subscriptions')}
            className="mt-8 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
            Abo einrichten
          </button>
        </>
      ) : subscriptions.length === 0 ? (
        /* Logged in but no subscriptions — same explanation, straight to the wizard */
        <>
          <p className="mt-6 text-smitten-text">Du hast noch kein Abo eingerichtet.</p>
          <AboExplainer />
          <Link href="/subscriptions/create"
            className="mt-8 inline-block bg-smitten-accent text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
            Abo einrichten
          </Link>
        </>
      ) : (
        /* List subscriptions */
        <div className="mt-6 space-y-4">
          {banner && (
            <p className="p-3 bg-white border border-smitten-cream rounded-xl text-sm text-smitten-text">
              {banner}
            </p>
          )}
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
                {isPaused && (
                  <p className="mt-2 text-sm text-amber-600">
                    Pausiert bis {new Date(sub.paused_until! + 'T00:00:00').toLocaleDateString('de-DE')}
                    {isPauseExpired && (
                      <button onClick={() => handleResume(sub.id)} disabled={busyId === sub.id}
                        className="ml-2 text-smitten-primary underline text-xs disabled:opacity-50">
                        {busyId === sub.id ? 'Wird reaktiviert...' : 'Jetzt reaktivieren'}
                      </button>
                    )}
                  </p>
                )}
                {sub.status === 'payment_failed' && (
                  <p className="mt-2 text-sm text-red-600">
                    Die letzte Zahlung hat nicht funktioniert. Hinterlege eine neue
                    Zahlungsmethode, dann l&auml;uft dein Abo weiter.
                  </p>
                )}
                {resumeError?.id === sub.id && (
                  <p className="mt-2 text-sm text-red-600">{resumeError.msg}</p>
                )}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(sub.status === 'active' || sub.status === 'paused' || sub.status === 'payment_failed') && (
                    <Link href={`/subscriptions/edit/${sub.id}`}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                      Bearbeiten
                    </Link>
                  )}
                  {(sub.status === 'active' || isPauseExpired) && (
                    <button onClick={() => { setPausingId(sub.id); setPauseUntil(''); setPauseError(''); }}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                      Pausieren
                    </button>
                  )}
                  {isPaused && !isPauseExpired && (
                    <button onClick={() => handleResume(sub.id)} disabled={busyId === sub.id}
                      className="text-xs border border-smitten-cream px-3 py-1.5 rounded-full text-green-600 hover:border-green-300 transition-colors disabled:opacity-50">
                      {busyId === sub.id ? 'Wird reaktiviert...' : 'Reaktivieren'}
                    </button>
                  )}
                  {sub.status === 'payment_failed' && !cardUpdate && (
                    <button onClick={() => startCardUpdate(sub.id)} disabled={busyId === sub.id}
                      className="text-xs bg-smitten-primary text-white px-3 py-1.5 rounded-full hover:bg-smitten-primary/90 transition-colors disabled:opacity-50">
                      {busyId === sub.id ? 'Wird geladen...' : 'Zahlungsmethode aktualisieren'}
                    </button>
                  )}
                  {(sub.status === 'active' || sub.status === 'payment_failed') && (
                    <button onClick={() => handleCancel(sub.id)} disabled={busyId === sub.id}
                      className="text-xs border border-red-200 px-3 py-1.5 rounded-full text-red-500 hover:border-red-300 transition-colors disabled:opacity-50">
                      {busyId === sub.id ? 'Wird gekündigt...' : 'Kündigen'}
                    </button>
                  )}
                  {sub.status === 'cancellation_pending' && (
                    <span className="text-xs text-orange-500">Kündigung wird beim nächsten Durchlauf bearbeitet</span>
                  )}
                </div>

                {/* Card update inline (payment_failed) */}
                {cardUpdate?.subId === sub.id && (
                  <Elements stripe={stripePromise} options={{ clientSecret: cardUpdate.clientSecret }}>
                    <CardUpdateForm
                      subId={sub.id}
                      onDone={() => finishCardUpdate(sub.id)}
                      onCancel={() => setCardUpdate(null)}
                    />
                  </Elements>
                )}

                {/* Pause form inline */}
                {pausingId === sub.id && (
                  <div className="mt-4 p-4 bg-smitten-cream rounded-xl space-y-3">
                    <p className="text-sm font-medium text-smitten-text">Abo pausieren</p>
                    <p className="text-xs text-smitten-text/60">
                      Die Pause beginnt sofort. Danach l&auml;uft dein Abo automatisch weiter.
                    </p>
                    <div>
                      <label className="block text-xs text-smitten-text mb-1">Pausieren bis</label>
                      <input type="date" value={pauseUntil} onChange={e => setPauseUntil(e.target.value)}
                        min={berlinDatePlusDays(1)}
                        className="w-full rounded-lg border border-smitten-cream px-3 py-1.5 text-sm bg-white" />
                    </div>
                    {pauseError && <p className="text-xs text-red-500">{pauseError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => { setPausingId(null); setPauseError(''); }}
                        className="px-4 py-1.5 text-xs border border-smitten-cream rounded-full text-smitten-text hover:border-smitten-text/30 transition-colors">
                        Abbrechen
                      </button>
                      <button onClick={() => handlePause(sub.id)} disabled={!pauseUntil || busyId === sub.id}
                        className="px-4 py-1.5 text-xs bg-smitten-primary text-white rounded-full hover:bg-smitten-primary/90 disabled:opacity-50 transition-colors">
                        {busyId === sub.id ? 'Wird pausiert...' : 'Pause speichern'}
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
