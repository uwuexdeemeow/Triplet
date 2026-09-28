import { Stack } from 'expo-router';
import { View } from 'react-native';

import { WebSidebar } from '@/components/web-sidebar';
import { useShareHandoff } from '@/share/share-intent';
import { useTheme } from '@/theme/theme';
import { useWideLayout } from '@/utils/layout';

export default function AppLayout() {
  const { colors } = useTheme();
  const wide = useWideLayout();
  // Something shared to Triplet opens "Save to a trip"; this layout only exists while signed in
  useShareHandoff();

  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[tripId]" />
      <Stack.Screen name="share" options={{ presentation: 'modal' }} />
    </Stack>
  );

  if (!wide) return stack;

  // On a big screen the website keeps a sidebar beside every page instead of the bottom tabs
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <WebSidebar />
      <View style={{ flex: 1, minWidth: 0 }}>{stack}</View>
    </View>
  );
}
