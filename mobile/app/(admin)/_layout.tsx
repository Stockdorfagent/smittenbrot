import { Stack } from 'expo-router';
import { Redirect } from 'expo-router';
import { theme } from '@/lib/theme';
import { useAuth } from '@/context/AuthContext';
import { LoadingScreen } from '@/components/LoadingScreen';

export default function AdminLayout() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !user.is_admin) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: theme.colors.white,
        headerTitleStyle: { fontWeight: '600', fontSize: theme.fontSize.lg },
      }}
    >
      <Stack.Screen name="index" options={{ headerTitle: 'Admin Dashboard' }} />
      <Stack.Screen name="orders" options={{ headerTitle: 'Bestellungen' }} />
      <Stack.Screen name="products" options={{ headerTitle: 'Produkte' }} />
      <Stack.Screen name="pickup-locations" options={{ headerTitle: 'Abholorte' }} />
      <Stack.Screen name="closures" options={{ headerTitle: 'Schließungen' }} />
      <Stack.Screen name="notifications" options={{ headerTitle: 'Benachrichtigungen' }} />
      <Stack.Screen name="settings" options={{ headerTitle: 'Einstellungen' }} />
    </Stack>
  );
}
