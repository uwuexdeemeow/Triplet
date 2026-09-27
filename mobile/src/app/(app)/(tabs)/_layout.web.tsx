// The website keeps a regular tab bar; phones use native tabs (_layout.tsx) for Liquid Glass on iOS
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useMyInvitations } from '@/api/trips';
import { useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

export default function TabsLayout() {
  const { colors } = useTheme();
  const invitations = useMyInvitations();
  const pending = invitations.data?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => <Feather name="briefcase" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="invites"
        options={{
          title: 'Invites',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onDanger, fontFamily: fonts.bold, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Feather name="mail" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
