import type { ConfigContext, ExpoConfig } from 'expo/config';

// Adds to app.json what depends on settings. Sign in with Google needs the iOS client's reversed
// id as a URL scheme, so its plugin is only added once EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set
// (see README.md, "Sign in with Google and Apple"). Without it the Google button stays hidden.
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  // "1234-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.1234-abc"
  const iosUrlScheme = iosClientId ? `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}` : null;

  return {
    ...config,
    name: config.name ?? 'Triplet',
    slug: config.slug ?? 'triplet',
    plugins: [
      ...(config.plugins ?? []),
      ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, object]] : []),
    ],
  };
};
