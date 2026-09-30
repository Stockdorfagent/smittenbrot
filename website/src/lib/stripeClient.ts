// The default entry point injects Stripe.js on IMPORT; '/pure' only does so when loadStripe() is called.
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Stripe } from '@stripe/stripe-js'; // type-only: erased at build, no script injection

/**
 * Stripe.js on demand (30.09.2026). It used to be started at module load in
 * three pages, and because Next.js prefetches linked routes, the homepage set
 * Stripe's cookies (__stripe_mid for a year, __stripe_sid) for every visitor
 * before any purchase — a consent problem under § 25 TDDDG / GDPR. Now the
 * script is fetched only when a payment form is actually rendered, i.e. in
 * the checkout or the Dauerbestellung card step, where it is necessary for
 * the contract and for Stripe's fraud prevention.
 */
let promise: Promise<Stripe | null> | null = null;
export function getStripe(): Promise<Stripe | null> {
  if (!promise) promise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  return promise;
}
