import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { theme } from '@/lib/theme';
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

export default function RootLayout() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
