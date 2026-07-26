import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Email unsubscribe landing page. The reminder emails link here with the
// customer id + their unguessable unsubscribe_token. A valid match turns off
// email reminders (reminder_email = false). Idempotent; re-enable in Profil.
export const dynamic = 'force-dynamic';

async function unsubscribe(customerId?: string, token?: string): Promise<'ok' | 'invalid'> {
  if (!customerId || !token) return 'invalid';
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, unsubscribe_token')
    .eq('id', customerId)
    .single();
  if (error || !customer || customer.unsubscribe_token !== token) return 'invalid';

  const { error: updErr } = await supabase
    .from('customers')
    .update({ reminder_email: false })
    .eq('id', customerId);
  if (updErr) return 'invalid';
  return 'ok';
}

export default async function AbmeldenPage({
  searchParams,
}: {
  searchParams: { c?: string; t?: string };
}) {
  const result = await unsubscribe(searchParams.c, searchParams.t);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {result === 'ok' ? (
          <>
            <h1 className="text-2xl font-bold text-smitten-text mb-3">Abgemeldet</h1>
            <p className="text-smitten-text/70 mb-6">
              Du erhältst keine Bestell-Erinnerungen per E-Mail mehr. Deine Bestellungen und
              Rechnungen bekommst du weiterhin. Du kannst Erinnerungen jederzeit in deinem Profil
              wieder aktivieren.
            </p>
            <Link
              href="/profile"
              className="inline-block bg-smitten-accent text-white px-6 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors"
            >
              Zum Profil
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-smitten-text mb-3">Link ungültig</h1>
            <p className="text-smitten-text/70 mb-6">
              Dieser Abmelde-Link ist ungültig oder abgelaufen. Du kannst deine
              Erinnerungs-Einstellungen jederzeit in deinem Profil ändern.
            </p>
            <Link
              href="/profile"
              className="inline-block bg-smitten-accent text-white px-6 py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors"
            >
              Zum Profil
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
