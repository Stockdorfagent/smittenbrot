import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { AdminOrderAlerts } from '@/components/AdminOrderAlerts';

export default function TabLayout() {
  const { itemCount } = useCart();
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  // The app requires an account — send unauthenticated users to login.
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  // Passwordless sign-up creates the profile with a blank name (the database
  // has no name to work from). Ask for it once before letting them shop — it
  // goes on the order confirmation and the invoice.
  if (!user.name?.trim()) return <Redirect href="/profile-setup" />;

  return (
    <>
      {/* Admin-only: ka-ching + notification on new paid orders (renders null) */}
      <AdminOrderAlerts />
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.white,
          borderTopColor: theme.colors.border,
          // Respect the phone's bottom inset (gesture bar / home indicator)
          // so the tab bar is never hidden behind the system navigation.
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textLight,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Start',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          tabBarLabel: 'Warenkorb',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" size={size} color={color} />,
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          tabBarLabel: 'Bestellungen',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          tabBarLabel: 'Abos',
          tabBarIcon: ({ color, size }) => <Ionicons name="repeat-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      </Tabs>
    </>
  );
}
