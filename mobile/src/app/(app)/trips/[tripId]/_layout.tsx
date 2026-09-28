import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function TripLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(sections)" />
      <Stack.Screen name="add-activity" options={{ presentation: 'modal' }} />
      <Stack.Screen name="add-place" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="expense" options={{ presentation: 'modal' }} />
      <Stack.Screen name="plan-draft" options={{ presentation: 'modal' }} />
      <Stack.Screen name="ask" options={{ presentation: 'modal' }} />
      <Stack.Screen name="places/[placeId]" />
      {/* Full screen, so swiping down on the map pans it instead of closing the picker */}
      <Stack.Screen name="pick-location" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="pick-activity-location" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
