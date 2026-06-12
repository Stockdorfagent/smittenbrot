import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/context/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, signInWithMagicLink } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        const { error: err } = await signUp(email, password, name, phone);
        if (err) {
          setError(err);
        } else {
          router.replace('/(tabs)');
        }
      } else {
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err);
        } else {
          router.replace('/(tabs)');
        }
      }
    } finally {
      setLoading(false);
    }
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
            <Text style={styles.logo}>Smittenbrot</Text>
            <Text style={styles.subtitle}>Artisanale Bäckerei aus München</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>{isRegister ? 'Konto erstellen' : 'Anmelden'}</Text>

            {error ? (
              <Text style={[styles.error, error.includes('Prüfe') && styles.success]}>{error}</Text>
            ) : null}

            {isRegister && (
              <Input label="Name" value={name} onChangeText={setName} placeholder="Dein Name" autoCapitalize="words" />
            )}
            <Input label="E-Mail" value={email} onChangeText={setEmail} placeholder="hallo@example.de" keyboardType="email-address" autoCapitalize="none" />
            {!isRegister && (
              <>
                <Input label="Passwort" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
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

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ODER</Text>
              <View style={styles.dividerLine} />
            </View>

            <Button title="Weiter mit Apple" onPress={() => setError('Apple Sign-In folgt')} variant="secondary" style={styles.socialButton} />
            <Button title="Weiter mit Google" onPress={() => setError('Google Sign-In folgt')} variant="secondary" style={styles.socialButton} />

            <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
              <Text style={styles.backText}>Zurück</Text>
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
  logo: {
    fontSize: theme.fontSize.hero,
    fontFamily: theme.fontFamily.display,
    color: theme.colors.primary,
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
