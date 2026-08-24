import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform, AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist the session on-device so the user stays logged in across app
    // restarts (until they log out). Without a storage adapter, React Native
    // has no localStorage and the session would be lost on every launch.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/**
 * The key supabase-js stores the session under.
 */
const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
export const AUTH_STORAGE_KEY = `sb-${projectRef}-auth-token`;

/**
 * Recover a stored session by force, from the tokens on disk.
 *
 * Why this exists: if the access token has expired and the refresh call fails
 * — no signal yet at launch, which is normal on a phone — then getSession()
 * resolves NULL and INITIAL_SESSION reports no session, so the app concludes
 * "logged out" and shows the login screen. But the refresh token is still
 * sitting in storage (verified), so the user is not logged out at all; the app
 * just asked at a bad moment. That was the "it makes me log in, then works on
 * the second launch" report.
 *
 * setSession() re-seeds the client from those stored tokens and refreshes them,
 * which getSession() will not do again once it has cached a null.
 *
 * Returns `rejected: true` only when the server actually refuses the refresh
 * token — that is a genuine logout. A network failure returns no session and no
 * rejection, meaning "try again shortly".
 */
export async function recoverStoredSession(): Promise<{
  session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'];
  rejected: boolean;
}> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { session: null, rejected: true }; // nothing stored = really logged out
    const blob = JSON.parse(raw) as { access_token?: string; refresh_token?: string };
    if (!blob?.refresh_token) return { session: null, rejected: true };

    const { data, error } = await supabase.auth.setSession({
      access_token: blob.access_token ?? '',
      refresh_token: blob.refresh_token,
    });
    if (error) {
      const msg = (error.message ?? '').toLowerCase();
      const refused = msg.includes('invalid') || msg.includes('revoked') ||
        msg.includes('already used') || msg.includes('not found');
      return { session: null, rejected: refused };
    }
    return { session: data.session ?? null, rejected: false };
  } catch {
    // Parse/storage trouble — treat as retryable rather than logging out.
    return { session: null, rejected: false };
  }
}

// Keep the access token fresh: auto-refresh while the app is in the foreground,
// pause it in the background (Supabase's recommended React Native setup).
if (Platform.OS !== 'web') {
  // Start it now as well as on change: at cold start the app is ALREADY
  // 'active', so no change event fires and auto-refresh never began — the
  // access token then expired after an hour with the app open.
  if (AppState.currentState === 'active') {
    supabase.auth.startAutoRefresh();
  }
  AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
