'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    // Check if user arrived via password reset link
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
      setIsRecovery(true);
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) setEmail(session.user.email || '');
      });
    }
  }, []);

  const handleResetPassword = async () => {
    if (!email) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) {
      setError(error.message);
    } else {
      setResetSent(true);
    }
    setLoading(false);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setError(error.message);
    } else {
      setError('Passwort erfolgreich geändert!');
      setIsRecovery(false);
    }
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push('/');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, phone } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Create customer record
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from('customers').upsert({
        id: session.user.id,
        email,
        name,
      }, { onConflict: 'id' });
    }

    setMode('login');
    setError('Registrierung erfolgreich! Bitte bestätige deine E-Mail.');
    setLoading(false);
  };

  const handleMagicLink = async () => {
    if (!email) return;
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      setError(error.message);
    } else {
      setMagicLinkSent(true);
    }
    setLoading(false);
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) setError(error.message);
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-display font-bold text-smitten-text text-center">
        {isRecovery ? 'Neues Passwort' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
      </h1>

      {isRecovery ? (
        <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Neues Passwort</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent" />
          </div>
          {error && (
            <div className={`p-3 rounded-lg text-sm ${error.includes('erfolgreich') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-smitten-primary text-white py-3 rounded-full font-medium hover:bg-smitten-primary/90 transition-colors disabled:opacity-50">
            {loading ? 'Wird gespeichert...' : 'Passwort speichern'}
          </button>
        </form>
      ) : (<>

      <div className="mt-6 flex gap-2 justify-center">
        <button
          onClick={() => { setMode('login'); setError(''); }}
          className={`px-4 py-2 rounded-full text-sm ${mode === 'login' ? 'bg-smitten-primary text-white' : 'bg-smitten-cream text-smitten-text/70'}`}
        >
          Anmelden
        </button>
        <button
          onClick={() => { setMode('register'); setError(''); }}
          className={`px-4 py-2 rounded-full text-sm ${mode === 'register' ? 'bg-smitten-primary text-white' : 'bg-smitten-cream text-smitten-text/70'}`}
        >
          Registrieren
        </button>
      </div>

      <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="mt-6 space-y-4">
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">E-Mail</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>
        {mode === 'register' && (
          <div>
            <label className="block text-sm font-medium text-smitten-text/70">Telefon (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-smitten-text/70">Passwort</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-smitten-cream px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-smitten-accent"
          />
        </div>

        {error && (
          <div className={`p-3 rounded-lg text-sm ${error.includes('erfolgreich') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-smitten-primary text-white py-3 rounded-full font-medium hover:bg-smitten-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Wird verarbeitet...' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </button>
      </form>

      <div className="mt-6 text-center">
        {!magicLinkSent ? (
          <button
            onClick={handleMagicLink}
            disabled={!email || loading}
            className="text-sm text-smitten-secondary hover:underline disabled:opacity-50"
          >
            Magischen Link senden
          </button>
        ) : (
          <p className="text-sm text-green-600">Magic Link gesendet! Prüfe dein E-Mail-Postfach.</p>
        )}
      </div>

      <div className="mt-6 relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-smitten-cream" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-smitten-bg px-2 text-smitten-text/40">oder</span>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <button
          onClick={() => handleOAuth('google')}
          className="w-full border border-smitten-cream bg-white py-2.5 rounded-full text-sm font-medium hover:bg-smitten-cream transition-colors"
        >
          Mit Google anmelden
        </button>
        <button
          onClick={() => handleOAuth('apple')}
          className="w-full border border-smitten-cream bg-white py-2.5 rounded-full text-sm font-medium hover:bg-smitten-cream transition-colors"
        >
          Mit Apple anmelden
        </button>
      </div>

      {mode === 'login' && (
        <>
          {resetSent ? (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 text-center">
              Passwort-Reset-Link wurde an {email} gesendet.
            </div>
          ) : (
          <>
          <div className="mt-4 text-center">
            <button
              onClick={handleResetPassword}
              disabled={!email || loading}
              className="text-sm text-smitten-secondary hover:underline disabled:opacity-50"
            >
              Passwort vergessen?
            </button>
          </div>
          <p className="mt-6 text-center text-sm text-smitten-text/60">
            Noch kein Konto?{' '}
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className="text-smitten-secondary hover:underline font-medium"
            >
              Jetzt registrieren
            </button>
          </p>
          </>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
