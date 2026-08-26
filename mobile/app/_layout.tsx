import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { theme } from '@/lib/theme';
import { useNotificationRouting } from '@/lib/notificationRouting';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Component, type ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#1A0000', padding: 20, justifyContent: 'center' }}>
          <ScrollView>
            <Text style={{ color: '#FF4444', fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>
              ⚠️ App Error
            </Text>
            <Text style={{ color: '#FF8888', fontSize: 14, fontFamily: 'monospace', marginBottom: 20 }}>
              {this.state.error.message}
            </Text>
            <Text style={{ color: '#FF8888', fontSize: 11, fontFamily: 'monospace' }}>
              {this.state.error.stack}
            </Text>
          </ScrollView>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: '#FF4444', padding: 14, borderRadius: 8, marginTop: 20 }}
          >
            <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

/**
 * Sends a tapped notification to the screen it is about. Lives inside
 * AuthProvider because orders and subscriptions need a session, and inside the
 * Stack because it navigates. Renders nothing.
 */
function NotificationRouter() {
  const { user } = useAuth();
  useNotificationRouting(!!user);
  return null;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <StripeProvider
        publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
        urlScheme="smittenbrot"
        // Registered with Apple and certified through Stripe. Without it the
        // payment sheet simply omits Apple Pay, with no error to explain why.
        merchantIdentifier="merchant.de.smittenbrot.app"
      >
        <AuthProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <NotificationRouter />
          <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
              headerTitle: '',
              headerBackTitle: 'Zurück',
              headerShadowVisible: false,
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
          {/* Screens not listed here inherit headerShown:false from the Stack
              and end up with no way back — the user is stuck. Both of these
              are pushed routes, so they need a header with a back button. */}
          <Stack.Screen
            name="subscription/edit"
            options={{
              headerShown: true,
              headerTitle: 'Abo bearbeiten',
              headerBackTitle: 'Zurück',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
            }}
          />
          <Stack.Screen
            name="admin-bakeday"
            options={{
              headerShown: true,
              headerTitle: 'Backtag-Übersicht',
              headerBackTitle: 'Zurück',
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.text,
            }}
          />
            </Stack>
          </CartProvider>
        </AuthProvider>
      </StripeProvider>
    </ErrorBoundary>
  );
}
