import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { registerAndSavePushToken, clearNotificationBadge } from '@/lib/push';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const refreshUser = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setState({ user: null, loading: false });
        return;
      }

      const { data: profile } = await supabase
        .from('customers')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profile) {
        setState({
          user: {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            is_admin: profile.is_admin ?? false,
          },
          loading: false,
        });
      } else {
        setState({
          user: {
            id: session.user.id,
            email: session.user.email ?? '',
            name: session.user.user_metadata?.name ?? '',
            is_admin: false,
          },
          loading: false,
        });
      }
    } catch {
      setState({ user: null, loading: false });
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      refreshUser();
    });
    return () => subscription?.unsubscribe();
  }, [refreshUser]);

  // Once a user is signed in, register this device for push notifications
  // and save the token so the backend can reach it. Best-effort.
  useEffect(() => {
    if (state.user?.id) {
      registerAndSavePushToken(state.user.id);
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
