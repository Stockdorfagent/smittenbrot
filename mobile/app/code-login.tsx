import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * Passwordless sign-in with a 6-digit email code — the primary way into the
 * app, for new and returning customers alike: enter email → receive code →
 * verify → signed in. No password, no confirmation link, no website hop.
 *
 * Typing the code back proves the address works, so verifying it also confirms
 * the email (Supabase sets email_confirmed_at) — which is what guarantees the
 * customer can actually receive their order confirmations and invoices.
 *
 * New accounts are created here (shouldCreateUser: true); the database creates
 * the matching customers profile row (migration 016) with an empty name, and
 * the auth gate then asks for the name once via /profile-setup.
 */
export default function CodeLoginScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Redirect once the session is established (verifyOtp sets it; AuthContext
  // picks it up via onAuthStateChange).
  useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user]);

  const sendCode = async () => {
    if (!email.trim()) {
      setError('Bitte gib deine E-Mail-Adresse ein.');
      return;
    }
    setError('');
    setInfo('');
    setLoading(true);
    // shouldCreateUser: true → one door for everyone. A returning customer is
    // signed in; a new one gets an account. A typo just means the code never
    // arrives, and no unconfirmed account can order (the code is never entered).
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (err) {
      setError(
        /rate|limit|seconds/i.test(err.message)
          ? 'Bitte warte einen Moment, bevor du einen neuen Code anforderst.'
          : err.message,
      );
      return;
    }
    setStep('code');
    setInfo('Wir haben dir einen 6-stelligen Code per E-Mail geschickt.');
  };

  const verify = async () => {
    if (code.trim().length < 6) {
      setError('Bitte gib den 6-stelligen Code ein.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setLoading(false);
    if (err) {
      setError('Code ungültig oder abgelaufen. Bitte fordere einen neuen an.');
      return;
    }
    // success → useEffect redirects once AuthContext sees the session.
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image source={require('../assets/logo-mark.png')} style={styles.logoImg} />
            <Text style={styles.brand}>Smittenbrot</Text>
            <Text style={styles.subtitle}>Sauerteig aus Stockdorf</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>Anmelden ohne Passwort</Text>
            {step === 'email' ? (
              <Text style={styles.lead}>
                Gib deine E-Mail-Adresse ein und du bekommst einen 6-stelligen Code.
                Neu bei Smittenbrot? Dann wird dein Konto dabei gleich angelegt.
              </Text>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}

            {step === 'email' ? (
              <>
                <Input
                  label="E-Mail"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="hallo@example.de"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Button title="Code senden" onPress={sendCode} loading={loading} style={{ marginTop: theme.spacing.sm }} />
              </>
            ) : (
              <>
                <Text style={styles.sentTo}>{email}</Text>
                <Input
                  label="Code"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />
                <Button title="Anmelden" onPress={verify} loading={loading} style={{ marginTop: theme.spacing.sm }} />
                <TouchableOpacity onPress={sendCode} style={styles.link}>
                  <Text style={styles.linkText}>Code erneut senden</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setStep('email'); setCode(''); setInfo(''); setError(''); }} style={styles.link}>
                  <Text style={styles.linkText}>E-Mail ändern</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity onPress={() => router.replace('/login')} style={styles.link}>
              <Text style={styles.linkText}>Zurück zur Passwort-Anmeldung</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
  header: { alignItems: 'center', marginBottom: theme.spacing.xl },
  logoImg: { width: 64, height: 64, resizeMode: 'contain', marginBottom: theme.spacing.sm },
  brand: { fontSize: theme.fontSize.xl, fontWeight: '700', color: theme.colors.text, fontFamily: theme.fontFamily.display },
  subtitle: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginTop: theme.spacing.xs },
  form: { backgroundColor: theme.colors.white, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg },
  title: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.sm },
  lead: { fontSize: theme.fontSize.sm, color: theme.colors.text, marginBottom: theme.spacing.md, lineHeight: 20 },
  error: { color: theme.colors.error, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.sm },
  info: { color: theme.colors.success, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.sm },
  sentTo: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginBottom: theme.spacing.sm },
  link: { alignItems: 'center', marginTop: theme.spacing.md },
  linkText: { color: theme.colors.textLight, fontSize: theme.fontSize.sm },
});
