import { Stack } from 'expo-router';

import { formPresentation, useFormDialog } from '@/components/form-layout';
import { useTheme } from '@/theme/theme';

export default function TripLayout() {
  const { colors } = useTheme();
  // Adding and editing open as dialogs over the trip on the website, and as sheets in the app
  const form = formPresentation(useFormDialog());
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(sections)" />
      <Stack.Screen name="add-activity" options={form} />
      <Stack.Screen name="add-place" options={form} />
      <Stack.Screen name="stay" options={form} />
      <Stack.Screen name="flight" options={form} />
      <Stack.Screen name="settings" options={form} />
      <Stack.Screen name="expense" options={form} />
      <Stack.Screen name="plan-draft" options={form} />
      <Stack.Screen name="ask" options={form} />
      <Stack.Screen name="places/[placeId]" />
      {/* Full screen, so swiping down on the map pans it instead of closing the picker */}
      <Stack.Screen name="pick-location" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="pick-activity-location" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
