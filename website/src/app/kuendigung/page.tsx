'use client';

import { useState } from 'react';

/**
 * Kündigungsbutton page — § 312k BGB.
 *
 * Reachable from the footer of every page, without logging in, because the
 * point of the provision is that cancelling must not be harder than signing up.
 *
 * The fields are the ones Absatz 2 asks for: the kind of cancellation (and, for
 * an extraordinary one, the reason), details that identify the person and the
 * contract, when it should end, and an address for the confirmation. The
 * confirmation button is labelled "jetzt kündigen" as the provision requires.
 *
 * After submitting, the declaration is shown back with the date and time it was
 * received, and can be printed or saved as PDF — Absatz 3 gives the consumer
 * the right to store it that way. The same content also goes out by email.
 */

type Result = {
  id: string;
  received_at: string;
  cancelled_subscriptions: number;
  matched_account: boolean;
  confirmation_email: string | null;
};

const inputClass =
  'mt-1 w-full rounded-lg border border-smitten-cream bg-white px-3 py-2 text-sm ' +
  'text-smitten-text focus:border-smitten-primary focus:outline-none';

export default function KuendigungPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contract, setContract] = useState('Smittenbrot Abo (automatische Bestellung)');
  const [kind, setKind] = useState<'ordentlich' | 'ausserordentlich'>('ordentlich');
  const [reason, setReason] = useState('');
  const [effectiveChoice, setEffectiveChoice] = useState<'naechstmoeglich' | 'datum'>('naechstmoeglich');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/kuendigung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          contract,
          kind,
          reason,
          effective_choice: effectiveChoice,
          effective_date: effectiveDate || null,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Deine Kündigung konnte nicht verarbeitet werden.');
        return;
      }
      setResult(data as Result);
    } catch {
      setError('Verbindung fehlgeschlagen. Bitte versuch es noch einmal.');
    } finally {
      setSending(false);
    }
  }

  if (result) {
    const received = new Date(result.received_at).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
    });
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-smitten-text">
        <h1 className="text-2xl font-display font-bold">Kündigung eingegangen</h1>

        <div className="mt-6 rounded-xl border border-smitten-cream bg-white p-6">
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Eingegangen am</dt>
              <dd className="font-medium">{received} Uhr</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Name</dt>
              <dd>{name}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">E-Mail</dt>
              <dd>{email}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Vertrag</dt>
              <dd>{contract}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Art der Kündigung</dt>
              <dd>{kind === 'ausserordentlich' ? 'Außerordentliche Kündigung' : 'Ordentliche Kündigung'}</dd>
            </div>
            {reason && (
              <div className="flex gap-3">
                <dt className="w-44 shrink-0 text-smitten-text/60">Kündigungsgrund</dt>
                <dd>{reason}</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Beendet</dt>
              <dd className="font-medium">
                {effectiveChoice === 'datum' && effectiveDate
                  ? new Date(effectiveDate + 'T12:00:00').toLocaleDateString('de-DE')
                  : result.cancelled_subscriptions > 0
                    ? 'sofort'
                    : 'zum nächstmöglichen Zeitpunkt'}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-smitten-text/60">Vorgangsnummer</dt>
              <dd className="font-mono text-xs">{result.id}</dd>
            </div>
          </dl>
        </div>

        <p className="mt-5 text-sm leading-relaxed">
          {result.cancelled_subscriptions > 0
            ? `Es ${result.cancelled_subscriptions === 1 ? 'wurde 1 laufendes Abo' : `wurden ${result.cancelled_subscriptions} laufende Abos`} beendet. Für dich wird keine weitere Bestellung mehr automatisch aufgegeben. Bereits bezahlte Bestellungen bleiben bestehen und kannst du wie gewohnt abholen.`
            : 'Wir konnten zu dieser E-Mail-Adresse kein laufendes Abo finden. Deine Kündigung ist trotzdem eingegangen und wird von uns geprüft — wir melden uns bei dir.'}
        </p>

        {result.confirmation_email ? (
          <p className="mt-3 text-sm text-smitten-text/70">
            Eine Bestätigung ist an {result.confirmation_email} unterwegs.
          </p>
        ) : (
          <p className="mt-3 text-sm text-smitten-primary">
            Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte sichere diese Seite und
            schreib uns kurz an info@smittenbrot.de.
          </p>
        )}

        <button
          onClick={() => window.print()}
          className="print:hidden mt-6 rounded-lg bg-smitten-primary px-5 py-2 text-sm text-white transition-colors hover:bg-smitten-primary/90"
        >
          Diese Bestätigung speichern oder drucken
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 text-smitten-text">
      <h1 className="text-2xl font-display font-bold">Verträge hier kündigen</h1>
      <p className="mt-3 text-sm leading-relaxed text-smitten-text/70">
        Hier kannst du dein Smittenbrot-Abo kündigen — ohne Anmeldung. Deine Kündigung wird sofort
        wirksam: es wird keine weitere Bestellung mehr automatisch für dich aufgegeben. Bereits
        bezahlte Bestellungen bleiben bestehen. Du bekommst umgehend eine Bestätigung per E-Mail.
      </p>
      <p className="mt-2 text-sm text-smitten-text/60">
        Wenn du angemeldet bist, kannst du dein Abo auch direkt unter{' '}
        <a href="/subscriptions" className="underline">Meine Abos</a> kündigen oder pausieren.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="rounded-xl border border-smitten-cream bg-white p-5 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="k-name">Name</label>
            <input
              id="k-name" className={inputClass} value={name} required
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- und Nachname"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="k-email">E-Mail-Adresse</label>
            <input
              id="k-email" type="email" className={inputClass} value={email} required
              onChange={(e) => setEmail(e.target.value)}
              placeholder="die Adresse deines Smittenbrot-Kontos"
            />
            <p className="mt-1 text-xs text-smitten-text/50">
              An diese Adresse schicken wir die Bestätigung deiner Kündigung.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="k-contract">Vertrag</label>
            <input
              id="k-contract" className={inputClass} value={contract} required
              onChange={(e) => setContract(e.target.value)}
            />
          </div>
        </div>

        <fieldset className="rounded-xl border border-smitten-cream bg-white p-5 space-y-4">
          <legend className="px-1 text-sm font-medium">Art der Kündigung</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio" name="kind" className="mt-1" checked={kind === 'ordentlich'}
              onChange={() => setKind('ordentlich')}
            />
            <span>Ordentliche Kündigung</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio" name="kind" className="mt-1" checked={kind === 'ausserordentlich'}
              onChange={() => setKind('ausserordentlich')}
            />
            <span>Außerordentliche Kündigung</span>
          </label>
          {kind === 'ausserordentlich' && (
            <div>
              <label className="text-sm font-medium" htmlFor="k-reason">Kündigungsgrund</label>
              <input
                id="k-reason" className={inputClass} value={reason} required
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-smitten-cream bg-white p-5 space-y-4">
          <legend className="px-1 text-sm font-medium">Zeitpunkt der Beendigung</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio" name="when" className="mt-1" checked={effectiveChoice === 'naechstmoeglich'}
              onChange={() => setEffectiveChoice('naechstmoeglich')}
            />
            <span>Zum nächstmöglichen Zeitpunkt</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio" name="when" className="mt-1" checked={effectiveChoice === 'datum'}
              onChange={() => setEffectiveChoice('datum')}
            />
            <span>Zum folgenden Datum</span>
          </label>
          {effectiveChoice === 'datum' && (
            <input
              type="date" className={inputClass} value={effectiveDate} required
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          )}
        </fieldset>

        <div>
          <label className="text-sm font-medium" htmlFor="k-message">Nachricht (freiwillig)</label>
          <textarea
            id="k-message" className={inputClass} rows={3} value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-smitten-primary">{error}</p>}

        <button
          type="submit"
          disabled={sending}
          className="rounded-lg bg-smitten-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-smitten-primary/90 disabled:opacity-50"
        >
          {sending ? 'Wird gesendet…' : 'jetzt kündigen'}
        </button>
      </form>
    </div>
  );
}
