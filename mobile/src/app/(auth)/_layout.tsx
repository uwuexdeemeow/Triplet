import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

// Signed-out visitors land on log in
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
