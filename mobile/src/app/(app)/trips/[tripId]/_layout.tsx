import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export default function TripLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="(sections)" />
      <Stack.Screen name="add-activity" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
