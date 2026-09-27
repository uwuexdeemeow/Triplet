import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[tripId]" />
    </Stack>
  );
}
