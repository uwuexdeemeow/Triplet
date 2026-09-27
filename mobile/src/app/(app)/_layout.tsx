import { Stack } from 'expo-router';

import { useShareHandoff } from '@/share/share-intent';
import { useTheme } from '@/theme/theme';

export default function AppLayout() {
  const { colors } = useTheme();
  // Something shared to Triplet opens "Save to a trip"; this layout only exists while signed in
  useShareHandoff();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[tripId]" />
      <Stack.Screen name="share" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
