import { requireOptionalNativeModule } from 'expo';
import { router, usePathname } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext, type ShareIntent } from 'expo-share-intent';
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';

// Sharing into Triplet needs the app's own build (development or store). Expo Go and the
// website don't have the native part, so there it's switched off and nothing changes.
export const canReceiveShares = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoShareIntentModule') != null;

export function ShareProvider({ children }: { children: ReactNode }) {
  return (
    <ShareIntentProvider options={{ disabled: !canReceiveShares, resetOnBackground: true }}>{children}</ShareIntentProvider>
  );
}

// TikTok shares text like "Check out this video! https://vm.tiktok.com/abc", so look inside it
export function sharedLink(shareIntent: ShareIntent): string | null {
  if (shareIntent.webUrl) return shareIntent.webUrl;
  return shareIntent.text?.match(/https?:\/\/\S+/)?.[0] ?? null;
}

/**
 * Opens the "Save to a trip" screen when something is shared to Triplet. Mounted only while
 * signed in, so a share that arrives while signed out waits until after signing in.
 */
export function useShareHandoff() {
  const { hasShareIntent, shareIntent } = useShareIntentContext();
  const pathname = usePathname();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent) {
      handled.current = null;
      return;
    }
    const key = `${shareIntent.webUrl ?? ''}|${shareIntent.text ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    // On iOS the share link already opened the screen (see +native-intent.tsx)
    if (pathname !== '/share') router.push('/share');
  }, [hasShareIntent, shareIntent, pathname]);
}
