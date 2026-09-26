import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

// Signed-out visitors land on log in
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }} />;
}
