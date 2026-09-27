import { Stack } from 'expo-router';

import { useTheme } from '@/theme/theme';

export const unstable_settings = {
  initialRouteName: 'trip',
};

// Only exists while someone is looking at a trip with a guest code
export default function GuestLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
