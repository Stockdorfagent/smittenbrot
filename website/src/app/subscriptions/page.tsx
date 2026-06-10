'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatPrice } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SubscriptionsPage() {
  const [user, setUser] = useState<unknown>(null);
  const [subscriptions, setSubscriptions] = useState<unknown[]>([]);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      if (session?.user) {
        supabase
          .from('subscriptions')
          .select('*, subscription_items(*), pickup_locations(*)')
          .eq('customer_id', session.user.id)
          .then(({ data }) => {
            if (data) setSubscriptions(data);
          });
      }
    });
  }, []);

  const handleStartSubscription = () => {
    if (user) {
      router.push('/subscriptions/create');
    } else {
      router.push('/login?redirect=/subscriptions/create');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold text-smitten-text">
        Abonnement
      </h1>

      <section className="mt-8">
        <h2 className="text-xl font-display font-bold text-smitten-text">
          Nie wieder Brot verpassen
        </h2>
        <p className="mt-3 text-smitten-text/70 leading-relaxed">
          Mit dem Abo-Service erhältst du jede Woche frisches Sauerteigbrot
          und Gebäck – genau auf deine Bedürfnisse abgestimmt. Wähle deine
          Lieblingsprodukte aus und lege fest, ob du mittwochs oder samstags
          abholen möchtest.
        </p>
      </section>

      <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Flexibel', desc: 'Pausiere jederzeit oder passe deine Produkte an.' },
          { title: 'Zuverlässig', desc: 'Deine Bestellung wird automatisch für dich reserviert.' },
          { title: 'Kündbar', desc: 'Jederzeit kündbar – kein Risiko.' },
        ].map(feature => (
          <div key={feature.title} className="bg-white rounded-xl p-5 border border-smitten-cream">
            <h3 className="font-display font-bold text-smitten-text">{feature.title}</h3>
            <p className="mt-2 text-sm text-smitten-text/60">{feature.desc}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 bg-smitten-cream rounded-xl p-6">
        <h3 className="font-display text-lg font-bold text-smitten-text mb-3">So funktioniert dein Abo</h3>
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
      </section>

      {subscriptions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-display font-bold text-smitten-text">
            Deine Abos
          </h2>
          <div className="mt-4 space-y-3">
            {(subscriptions as Record<string, unknown>[]).map((sub) => (
              <div key={sub.id as string} className="bg-white rounded-xl p-4 border border-smitten-cream">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-smitten-text">
                    Abo – {(sub.status as string)}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    sub.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {sub.status === 'active' ? 'Aktiv' : String(sub.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <button
        onClick={handleStartSubscription}
        className="mt-8 w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 transition-colors"
      >
        {user ? 'Abo zusammenstellen' : 'Für Abo anmelden'}
      </button>
    </div>
  );
}
