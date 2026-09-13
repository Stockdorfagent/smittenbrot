'use client';

/**
 * Return page for redirect-based payments (PayPal, and the rare 3-D Secure
 * flow that leaves the page). Stripe sends the customer back here with
 * ?payment_intent=pi_…&redirect_status=succeeded|failed|processing.
 *
 * Card payments normally never come here (confirmPayment uses
 * redirect: 'if_required'), which is why this page did not exist until
 * PayPal was added on 13.09.2026.
 *
 * Success path: the stripe-webhook creates the order from the PaymentIntent
 * metadata within a few seconds. We clear the cart, poll for the order by
 * PaymentIntent id and hand over to the Bestellbestätigung (/orders/[id]).
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';

function SuccessInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { clearCart } = useCart();
  const [state, setState] = useState<'waiting' | 'slow' | 'failed' | 'missing'>('waiting');

  const paymentIntentId = params.get('payment_intent');
  const redirectStatus = params.get('redirect_status');

  useEffect(() => {
    if (!paymentIntentId) {
      setState('missing');
      return;
    }
    if (redirectStatus === 'failed' || redirectStatus === 'canceled') {
      setState('failed');
      return;
    }
    // succeeded or processing: the money side is done or pending on Stripe's
    // side; the order appears as soon as the webhook has run.
    clearCart();
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        const { data } = await supabase
          .from('orders')
          .select('id, payment_status')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle();
        if (data?.id && data.payment_status === 'paid') {
          router.replace(`/orders/${data.id}`);
          return;
        }
        if (attempt === 7) setState('slow');
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) setState('slow');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentIntentId, redirectStatus]);

  if (state === 'failed') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Zahlung nicht abgeschlossen</h1>
        <p className="mt-4 text-smitten-text leading-relaxed">
          Die Zahlung wurde abgebrochen oder abgelehnt. Es wurde nichts abgebucht und keine Bestellung angelegt.
          Dein Warenkorb ist noch da.
        </p>
        <Link href="/checkout" className="mt-8 inline-block bg-smitten-accent text-white px-8 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors">
          Zurück zur Kasse
        </Link>
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Keine Zahlung gefunden</h1>
        <p className="mt-4 text-smitten-text leading-relaxed">Diese Seite wird nur nach einer Zahlung aufgerufen.</p>
        <Link href="/orders" className="mt-8 inline-block text-smitten-primary underline">Zu meinen Bestellungen</Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-display font-bold text-smitten-text">Zahlung erhalten</h1>
      <p className="mt-4 text-smitten-text leading-relaxed">
        Deine Bestellung wird gerade angelegt. Einen Moment bitte …
      </p>
      {state === 'slow' && (
        <p className="mt-6 text-sm text-smitten-secondary leading-relaxed">
          Das dauert gerade etwas länger als üblich. Die Bestellbestätigung kommt per E-Mail, und die Bestellung
          erscheint unter{' '}
          <Link href="/orders" className="text-smitten-primary underline">Meine Bestellungen</Link>.
        </p>
      )}
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto px-4 py-16 text-center text-smitten-text/40">Lädt …</div>}>
      <SuccessInner />
    </Suspense>
  );
}
