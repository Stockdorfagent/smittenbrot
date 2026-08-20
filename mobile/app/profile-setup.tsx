import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * Asked once, right after a passwordless sign-up: the customers row is created
 * by the database with an empty name, and the name is needed to address people
 * in order confirmations and invoices. The auth gate in (tabs)/_layout sends
 * anyone with a blank name here, so this cannot be skipped.
 */
export default function ProfileSetupScreen() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Bitte gib deinen Namen ein.');
      return;
    }
    if (!user) return;
    setError('');
    setLoading(true);
    const { error: err } = await supabase
      .from('customers')
      .update({ name: trimmed })
      .eq('id', user.id);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    // Pulls the new name into context; the gate then lets the tabs render.
    await refreshUser();
    setLoading(false);
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
            <Text style={styles.title}>Willkommen!</Text>
            <Text style={styles.lead}>
              Wie dürfen wir dich nennen? Der Name steht auf deiner Bestellbestätigung.
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Dein Name"
              autoCapitalize="words"
            />
            <Button title="Weiter" onPress={save} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />
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
});
