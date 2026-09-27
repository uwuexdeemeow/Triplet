import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export default function TripLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="(sections)" />
      <Stack.Screen name="add-activity" options={{ presentation: 'modal' }} />
      <Stack.Screen name="add-place" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="expense" options={{ presentation: 'modal' }} />
      <Stack.Screen name="places/[placeId]" />
      {/* Full screen, so swiping down on the map pans it instead of closing the picker */}
      <Stack.Screen name="pick-location" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="pick-activity-location" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
