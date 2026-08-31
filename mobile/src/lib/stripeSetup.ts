import { supabase } from '@/lib/supabase';
import type { useStripe } from '@stripe/stripe-react-native';

/** The two PaymentSheet functions, exactly as useStripe() returns them. */
type PaymentSheetFns = Pick<ReturnType<typeof useStripe>, 'initPaymentSheet' | 'presentPaymentSheet'>;

/**
 * Collect and save a payment method via the Stripe PaymentSheet (SetupIntent).
 *
 * One implementation for every "hinterlege eine Karte" moment: the
 * payment_failed recovery on the Abo screen and the needs_payment_method
 * branch when a one-time order is converted into an Abo. Returns
 * { ok: true } when a card was saved, { ok: false, cancelled } when the
 * customer backed out, { ok: false, error } otherwise.
 *
 * The caller provides the PaymentSheet functions from useStripe() — hooks
 * cannot run here.
 */
export async function collectPaymentMethod(
  sheet: PaymentSheetFns,
): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: {} });
  if (error || !data?.setupIntentClientSecret) {
    return { ok: false, error: 'Zahlungsmethode konnte nicht geladen werden.' };
  }
  const init = await sheet.initPaymentSheet({
    merchantDisplayName: 'Smittenbrot',
    setupIntentClientSecret: data.setupIntentClientSecret,
    customerId: data.customerId,
    customerEphemeralKeySecret: data.ephemeralKey,
    returnURL: 'smittenbrot://stripe-redirect',
    // Same wallets as at subscription creation — otherwise someone who paid
    // with Apple Pay could only switch to a plain card here.
    applePay: {
      merchantCountryCode: 'DE',
    },
    googlePay: {
      merchantCountryCode: 'DE',
      currencyCode: 'EUR',
      testEnv: !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live'),
    },
  });
  if (init.error) return { ok: false, error: init.error.message };
  const { error: sheetError } = await sheet.presentPaymentSheet();
  if (sheetError) {
    if (sheetError.code === 'Canceled') return { ok: false, cancelled: true };
    return { ok: false, error: sheetError.message };
  }
  return { ok: true };
}
