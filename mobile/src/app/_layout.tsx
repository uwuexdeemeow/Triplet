import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ApiError } from '@/api/client';
import { SessionProvider, useSession } from '@/auth/session';
import { ShareProvider } from '@/share/share-intent';
import { ThemeProvider, useTheme } from '@/theme/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retrying won't fix a 4xx like "not found", only network and server errors
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });


  return (
    // First, so a share that launched the app is caught before anything else loads
    <ShareProvider>
      <ThemeProvider>
        <ThemedRoot>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              {/* If the fonts fail to load, carry on with the system fonts */}
              <RootNavigator fontsReady={fontsLoaded || fontError !== null} />
            </SessionProvider>
          </QueryClientProvider>
        </ThemedRoot>
      </ThemeProvider>
    </ShareProvider>
  );
}

// The app's background and status bar, in the current theme
function ThemedRoot({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();

  // On the web, colour the page behind the app too, so scrolling past the edge doesn't flash white
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.backgroundColor = colors.bg;
    document.documentElement.style.colorScheme = scheme;
  }, [colors.bg, scheme]);

  return (
    // Swipe gestures (like swiping a saved link to delete it) need this at the root
    <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </GestureHandlerRootView>
  );
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { colors, ready: themeReady } = useTheme();
  const { status } = useSession();
  const ready = fontsReady && themeReady && status !== 'loading';

  // Keep the splash screen up until we know whether the user is signed in, and which theme to show
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
