'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Fehler beim Senden');
        setSending(false);
        return;
      }
      setSent(true);
    } catch {
      setError('Verbindungsfehler');
    }
    setSending(false);
  };

  if (sent) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-2xl text-green-600">✓</div>
        <h1 className="mt-4 text-2xl font-display font-bold text-smitten-text">Nachricht gesendet!</h1>
        <p className="mt-2 text-smitten-text/60">Ich melde mich so schnell wie möglich bei dir.</p>
        <Link href="/" className="mt-6 inline-block text-smitten-primary hover:underline">Zurück zur Startseite</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-display font-bold text-smitten-text">Lass von dir hören</h1>

      <p className="mt-4 text-smitten-text/70 leading-relaxed">
        Hast du Fragen zu den Inhaltsstoffen, Anmerkungen zum Brot oder Feedback zu deiner letzten Bestellung?
        Vielleicht möchtest du auch eine neue Sorte vorschlagen oder hast eine Frage zum Ablauf der Abholung?
        Dann melde dich gerne – ich freue mich immer über den direkten Austausch mit dir.
      </p>

      <h2 className="mt-10 text-xl font-display font-bold text-smitten-text">Großbestellungen &amp; Kooperationen</h2>
      <p className="mt-2 text-smitten-text/70 leading-relaxed">
        Du planst ein Event, eine Feier oder hast Interesse an einer regelmäßigen Zusammenarbeit?
        Wenn du eine größere Menge (ab ca. 30 Brote) benötigst oder gastronomisches Interesse hast, bist du hier genau richtig.
        Schreib mir einfach – wir finden bestimmt eine köstliche Lösung.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-4">
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">E-Mail *</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Betreff (optional)</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Nachricht *</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} required rows={6}
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-primary/30 resize-y" />
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

        <button type="submit" disabled={sending}
          className="w-full bg-smitten-accent text-white py-3 rounded-full font-medium hover:bg-smitten-accent/90 disabled:opacity-50 transition-colors">
          {sending ? 'Wird gesendet...' : 'Nachricht senden'}
        </button>
      </form>
    </div>
  );
}
