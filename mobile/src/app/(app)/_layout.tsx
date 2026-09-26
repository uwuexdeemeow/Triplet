import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

// Screens that open on top of the tab bar (a trip, a place, the pin picker) will be added here
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
