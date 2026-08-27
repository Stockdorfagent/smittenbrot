import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { supabase, recoverStoredSession } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import {
  registerAndSavePushToken,
  clearNotificationBadge,
  ensureOrderChannel,
  syncPushRegistration,
} from '@/lib/push';
import type { AuthState } from '@/lib/types';

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Backoff between attempts to recover a stored session (ms). */
const RECOVERY_DELAYS = [1000, 3000, 6000];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  /** Resolve a session into the app's user state (profile row + admin flag). */
  const applySession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setState({ user: null, loading: false });
      return;
    }

    // Retry the profile read before giving up on it.
    //
    // The first request after a cold start — especially the first launch after
    // an app update — regularly loses the race with the network stack or with
    // the token being attached. That used to fall straight through to the
    // fallback below, and because the fallback invents an empty name, the auth
    // gate concluded the customer had never given one and sent them to
    // /profile-setup. An existing customer was asked for their name again on
    // every update, which is exactly what a tester reported.
    let profile: Record<string, unknown> | null = null;
    let missingRow = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (data) { profile = data; break; }
      // An empty result is NOT proof the row is absent: row-level security
      // filters out everything when the request goes out before the token is
      // attached, and that comes back as no rows and no error — exactly what a
      // genuinely missing row looks like. So keep retrying either way, and only
      // believe "absent" once the last attempt still says so.
      if (attempt === 2) {
        missingRow = !error;
      } else {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    if (profile) {
      setState({
        user: {
          id: profile.id as string,
          email: profile.email as string,
          name: (profile.name as string) ?? '',
          is_admin: (profile.is_admin as boolean) ?? false,
          profileLoaded: true,
        },
        loading: false,
      });
      return;
    }

    // No profile to show. The session is still valid, so stay signed in — but
    // record whether we actually know there is no row (missingRow: the database
    // answered, and the row is not there) or merely failed to ask. Only the
    // former justifies asking for a name.
    setState({
      user: {
        id: session.user.id,
        email: session.user.email ?? '',
        name: (session.user.user_metadata?.name as string) ?? '',
        is_admin: false,
        profileLoaded: missingRow,
      },
      loading: false,
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await applySession(session);
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;

    // Drive everything from onAuthStateChange. supabase-js emits
    // INITIAL_SESSION once it has read (and if necessary refreshed) the stored
    // session, so that — not an eager getSession() — is the authoritative
    // "are we logged in" signal.
    //
    // The bug this fixes: refreshUser() ran on mount and a null getSession()
    // was treated as logged out. On a cold start that could resolve before the
    // AsyncStorage read finished, so the auth gate redirected to /login while
    // the session appeared moments later — which is why closing the app and
    // opening it again always worked.
    const timers: ReturnType<typeof setTimeout>[] = [];

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session?.user) {
        applySession(session);
      } else {
        // Do NOT conclude "logged out" here — see attemptRecovery.
        attemptRecovery(0);
      }
    });

    /**
     * A null session can mean two very different things: really logged out, or
     * the access token expired and the refresh call could not be made (no
     * signal yet at launch). In the second case the refresh token is still on
     * disk, so we keep the user logged in and retry instead of throwing them
     * at the login screen — which is what made the first launch ask for a
     * password while the second launch worked.
     */
    const attemptRecovery = async (attempt: number) => {
      if (cancelled) return;
      const { session, rejected } = await recoverStoredSession();
      if (cancelled) return;

      if (session?.user) {
        applySession(session);
        return;
      }
      if (rejected) {
        // The server refused the refresh token, or there is nothing stored:
        // a genuine logout.
        setState({ user: null, loading: false });
        return;
      }
      if (attempt < RECOVERY_DELAYS.length) {
        timers.push(setTimeout(() => attemptRecovery(attempt + 1), RECOVERY_DELAYS[attempt]));
        return;
      }
      // Out of retries: show the login screen, but the stored token is left
      // untouched so the next launch can still recover.
      setState({ user: null, loading: false });
    };

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      subscription?.unsubscribe();
    };
  }, [applySession]);

  // Once a user is signed in, register this device for push notifications
  // and save the token so the backend can reach it. Best-effort.
  useEffect(() => {
    if (state.user?.id) {
      registerAndSavePushToken(state.user.id);
      // The ka-ching channel must exist before a push arrives, or Android
      // falls back to the default sound for good.
      ensureOrderChannel();
    }
  }, [state.user?.id]);

  // Opening the app clears the icon badge. Without this the launcher kept
  // showing a count for notifications that had already been read, and the app
  // has no inbox screen to explain it.
  useEffect(() => {
    clearNotificationBadge();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') clearNotificationBadge();
    });
    return () => sub.remove();
  }, []);

  // Coming back to the app is the only moment we can notice that notifications
  // were switched off in the system settings. Re-syncing here keeps the stored
  // push token honest, so the backend falls back to email for anyone who can no
  // longer be reached in the app. Never prompts.
  useEffect(() => {
    const userId = state.user?.id;
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncPushRegistration(userId);
    });
    return () => sub.remove();
  }, [state.user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    // The customers profile row is created by the database (migration 016) from
    // this metadata. Doing it here used to fail: with email confirmation on,
    // signUp() returns no session, so the insert ran unauthenticated and RLS
    // refused it — leaving an account with no profile.
    if (error) return { error: error.message, needsConfirmation: false };
    // No session ⇒ the address must be confirmed before they can sign in.
    return { error: null, needsConfirmation: !data.session };
  };

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    return { error: error?.message ?? null };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({ user: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signInWithMagicLink, resetPassword, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
