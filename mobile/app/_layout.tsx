import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { theme } from '@/lib/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <CartProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(admin)" options={{ headerShown: false }} />
          <Stack.Screen
            name="cart"
            options={{
              headerShown: true,
              headerTitle: 'Warenkorb',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="checkout"
            options={{
              headerShown: true,
              headerTitle: 'Kasse',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="order/[id]"
            options={{
              headerShown: true,
              headerTitle: 'Bestellung',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
            }}
          />
          <Stack.Screen
            name="subscription/create"
            options={{
              headerShown: true,
              headerTitle: 'Abonnement erstellen',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
              presentation: 'modal',
            }}
          />
        </Stack>
      </CartProvider>
    </AuthProvider>
  );
}
