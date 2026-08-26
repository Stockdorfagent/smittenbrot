'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Cancellations declared through the public /kuendigung page.
 *
 * That form cannot ask for a login (§ 312k BGB), so knowing an email address is
 * enough to declare a cancellation for someone else. Rather than obstruct the
 * form, the Abo is put on hold — `cancellation_pending`, which stops the next
 * order, so nobody is charged while it waits — and finalised here.
 *
 * Until one of the two buttons is pressed, the subscription-engine leaves the
 * Abo alone (it normally turns pending into cancelled every 30 minutes). So an
 * unreviewed row is not an idle to-do: it is a customer whose bread has stopped.
 */

interface CancellationRequest {
  id: string;
  declared_name: string;
  declared_email: string;
  contract_label: string;
  cancellation_kind: string;
  cancellation_reason: string | null;
  effective_choice: string;
  effective_date: string | null;
  message: string | null;
  customer_id: string | null;
  subscription_ids: string[];
  received_at: string;
  confirmation_sent_at: string | null;
  confirmation_error: string | null;
  resolution: string | null;
  resolved_at: string | null;
}

function deDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminCancellationsPage() {
  const [requests, setRequests] = useState<CancellationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('cancellation_requests')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(100);
    setRequests((data ?? []) as CancellationRequest[]);
    setLoading(false);
  }

  async function resolve(req: CancellationRequest, resolution: 'confirmed' | 'discarded') {
    const question = resolution === 'confirmed'
      ? `Kündigung von ${req.declared_name} bestätigen? Das Abo wird endgültig beendet.`
      : `Kündigung von ${req.declared_name} verwerfen? Das Abo läuft normal weiter — ` +
        'sinnvoll, wenn die Kündigung nicht von der Kundin oder dem Kunden selbst kam.';
    if (!confirm(question)) return;

    setBusyId(req.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Resolve the subscriptions first. If this fails, the request stays open
      // so the decision can be made again — better than a resolved request
      // whose Abo is stuck in limbo.
      if (req.subscription_ids.length > 0) {
        const { error: subError } = await supabase
          .from('subscriptions')
          .update({ status: resolution === 'confirmed' ? 'cancelled' : 'active' })
          .in('id', req.subscription_ids);
        if (subError) {
          alert(`Abo konnte nicht aktualisiert werden: ${subError.message}`);
          return;
        }
      }

      const { error } = await supabase
        .from('cancellation_requests')
        .update({
          resolution,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq('id', req.id);
      if (error) {
        alert(error.message);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Kündigungen...</p>
      </div>
    );
  }

  const open = requests.filter((r) => !r.resolution);
  const resolved = requests.filter((r) => r.resolution);
  const shown = showResolved ? resolved : open;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Kündigungen</h1>
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="text-sm text-smitten-secondary underline hover:text-smitten-primary"
        >
          {showResolved ? `Offene anzeigen (${open.length})` : `Erledigte anzeigen (${resolved.length})`}
        </button>
      </div>

      <p className="mt-2 text-sm text-smitten-text/60">
        Kündigungen über die öffentliche Seite <span className="font-mono text-xs">/kuendigung</span>.
        Diese Seite verlangt keine Anmeldung — deshalb wird das Abo zunächst nur angehalten und
        erst hier endgültig beendet. Solange eine Kündigung offen ist, wird für die Kundin oder den
        Kunden <strong>keine Bestellung mehr aufgegeben</strong>.
      </p>

      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-smitten-cream bg-white p-8 text-center text-sm text-smitten-text/60">
          {showResolved ? 'Noch nichts erledigt.' : 'Keine offenen Kündigungen.'}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {shown.map((req) => (
            <div key={req.id} className="rounded-xl border border-smitten-cream bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-smitten-text">{req.declared_name}</p>
                  <p className="text-xs text-smitten-text/60">{req.declared_email}</p>
                </div>
                <p className="text-xs text-smitten-text/50">
                  eingegangen {deDateTime(req.received_at)} Uhr
                </p>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-smitten-text/50">Abo</dt>
                  <dd className="text-smitten-text/80">{req.contract_label}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-smitten-text/50">Art</dt>
                  <dd className="text-smitten-text/80">
                    {req.cancellation_kind === 'ausserordentlich' ? 'Außerordentlich' : 'Ordentlich'}
                    {req.cancellation_reason ? ` — ${req.cancellation_reason}` : ''}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-smitten-text/50">Zum</dt>
                  <dd className="text-smitten-text/80">
                    {req.effective_date
                      ? new Date(req.effective_date + 'T12:00:00').toLocaleDateString('de-DE')
                      : 'nächstmöglichen Zeitpunkt'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-smitten-text/50">Konto</dt>
                  <dd className={req.customer_id ? 'text-smitten-text/80' : 'text-smitten-primary'}>
                    {req.customer_id
                      ? `zugeordnet · ${req.subscription_ids.length} Abo(s) angehalten`
                      : 'kein Konto gefunden — bitte selbst prüfen'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0 text-smitten-text/50">Bestätigung</dt>
                  <dd className={req.confirmation_error ? 'text-smitten-primary' : 'text-smitten-text/80'}>
                    {req.confirmation_sent_at
                      ? `verschickt ${deDateTime(req.confirmation_sent_at)} Uhr`
                      : req.confirmation_error
                        ? `FEHLGESCHLAGEN: ${req.confirmation_error}`
                        : 'nicht verschickt'}
                  </dd>
                </div>
                {req.resolution && (
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-smitten-text/50">Erledigt</dt>
                    <dd className="text-smitten-text/80">
                      {req.resolution === 'confirmed' ? 'Bestätigt' : 'Verworfen'}
                      {req.resolved_at ? ` · ${deDateTime(req.resolved_at)} Uhr` : ''}
                    </dd>
                  </div>
                )}
              </dl>

              {req.message && (
                <p className="mt-3 rounded-lg bg-smitten-cream/60 px-3 py-2 text-xs text-smitten-text/70">
                  {req.message}
                </p>
              )}

              {!req.resolution && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => resolve(req, 'confirmed')}
                    disabled={busyId === req.id}
                    className="rounded-lg bg-smitten-primary px-3 py-1.5 text-xs text-white transition-colors hover:bg-smitten-primary/90 disabled:opacity-50"
                  >
                    Kündigung bestätigen
                  </button>
                  <button
                    onClick={() => resolve(req, 'discarded')}
                    disabled={busyId === req.id}
                    className="rounded-lg border border-smitten-cream px-3 py-1.5 text-xs text-smitten-text/60 transition-colors hover:border-smitten-text/30 disabled:opacity-50"
                  >
                    Verwerfen — Abo läuft weiter
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
