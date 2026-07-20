import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/context/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { user, signIn, signUp, signInWithMagicLink, resetPassword } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect once the session is actually established — doing it here (rather
  // than right after signIn) avoids the "log in twice" race where the auth
  // gate bounced back to login before the session had propagated.
  useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user]);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        const { error: err } = await signUp(email, password, name, phone);
        if (err) setError(err);
      } else {
        const { error: err } = await signIn(email, password);
        if (err) setError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Bitte gib zuerst deine E-Mail-Adresse ein.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: err } = await resetPassword(email);
    setLoading(false);
    setError(err ?? 'Wir haben dir eine E-Mail zum Zurücksetzen deines Passworts geschickt.');
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError('Bitte E-Mail-Adresse eingeben');
      return;
    }
    setError('');
    setLoading(true);
    const { error: err } = await signInWithMagicLink(email);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      setError('Prüfe deine E-Mails für den Login-Link');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image source={require('../assets/logo-mark.png')} style={styles.logoImg} />
            <Text style={styles.brand}>Smittenbrot</Text>
            <Text style={styles.subtitle}>Sauerteig aus Stockdorf</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>{isRegister ? 'Konto erstellen' : 'Anmelden'}</Text>

            {error ? (
              <Text style={[styles.error, (error.includes('Prüfe') || error.includes('geschickt')) && styles.success]}>{error}</Text>
            ) : null}

            {isRegister && (
              <Input label="Name" value={name} onChangeText={setName} placeholder="Dein Name" autoCapitalize="words" />
            )}
            <Input label="E-Mail" value={email} onChangeText={setEmail} placeholder="hallo@example.de" keyboardType="email-address" autoCapitalize="none" />
            {!isRegister && (
              <>
                <Input label="Passwort" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
                <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotLink}>
                  <Text style={styles.forgotText}>Passwort vergessen?</Text>
                </TouchableOpacity>
                <Button title="Magic Link senden" onPress={handleMagicLink} variant="ghost" size="sm" loading={loading} />
              </>
            )}
            {isRegister && (
              <>
                <Input label="Telefon" value={phone} onChangeText={setPhone} placeholder="+49 89 123456" keyboardType="phone-pad" />
                <Input label="Passwort" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
              </>
            )}

            <Button
              title={isRegister ? 'Konto erstellen' : 'Anmelden'}
              onPress={handleSubmit}
              loading={loading}
              size="lg"
              style={styles.submitButton}
            />

            <TouchableOpacity onPress={() => { setIsRegister(!isRegister); setError(''); }}>
              <Text style={styles.switchText}>
                {isRegister ? 'Bereits ein Konto? Anmelden' : 'Noch kein Konto? Registrieren'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  logoImg: {
    width: 88,
    height: 88,
    resizeMode: 'contain',
  },
  brand: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.primary,
    marginTop: theme.spacing.sm,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  forgotText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.secondary,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  form: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  success: {
    color: theme.colors.success,
  },
  submitButton: {
    marginTop: theme.spacing.sm,
  },
  switchText: {
    textAlign: 'center',
    color: theme.colors.secondary,
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: theme.spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  dividerText: {
    marginHorizontal: theme.spacing.md,
    color: theme.colors.textLight,
    fontSize: theme.fontSize.xs,
  },
  socialButton: {
    marginBottom: theme.spacing.sm,
  },
  backLink: {
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  backText: {
    color: theme.colors.textLight,
    fontSize: theme.fontSize.sm,
  },
});
