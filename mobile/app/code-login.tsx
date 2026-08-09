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
 * Passwordless login with a 6-digit email code — no website hop.
 * enter email → receive code → verify → logged in. Ideal for migrated
 * customers signing in for the first time.
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
    // shouldCreateUser: false → login for existing customers only (no account
    // is silently created on a typo). New customers use "Konto erstellen".
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (err) {
      setError(
        /not allowed|signups/i.test(err.message)
          ? 'Für diese E-Mail gibt es noch kein Konto. Bitte erstelle zuerst ein Konto.'
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
            <Text style={styles.title}>Mit Code anmelden</Text>

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
  title: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.md },
  error: { color: theme.colors.error, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.sm },
  info: { color: theme.colors.success, fontSize: theme.fontSize.sm, marginBottom: theme.spacing.sm },
  sentTo: { fontSize: theme.fontSize.sm, color: theme.colors.textLight, marginBottom: theme.spacing.sm },
  link: { alignItems: 'center', marginTop: theme.spacing.md },
  linkText: { color: theme.colors.textLight, fontSize: theme.fontSize.sm },
});
