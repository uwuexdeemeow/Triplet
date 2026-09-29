import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform, TurboModuleRegistry } from 'react-native';

// What the server needs to check a Google or Apple sign-in (see social_login.py)
export type SocialSignIn = {
  provider: 'google' | 'apple';
  id_token: string;
  nonce?: string;
  name?: string;
};

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// Google's package can't even be imported without its native part (missing in Expo Go and in
// builds made before it was added), so it's only loaded when present
type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleModule | null | undefined;

function loadGoogle(): GoogleModule | null {
  if (google !== undefined) return google;
  google = null;
  if (Platform.OS === 'web' || !GOOGLE_WEB_CLIENT_ID) return google;
  if (Platform.OS === 'ios' && !GOOGLE_IOS_CLIENT_ID) return google;
  if (TurboModuleRegistry.get('RNGoogleSignin') == null) return google;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  google = require('@react-native-google-signin/google-signin') as GoogleModule;
  // Tokens are asked for with the web client id, which is what the server checks them against
  google.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
  return google;
}

export function googleAvailable(): boolean {
  return loadGoogle() !== null;
}

// Apple's button only works on iPhone and iPad (and not in the simulator without an Apple ID)
export async function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

// null when the person closed the sign-in sheet
export async function signInWithGoogle(): Promise<SocialSignIn | null> {
  const module = loadGoogle();
  if (!module) throw new Error('Google sign-in isn’t set up in this version of the app.');
  const { GoogleSignin } = module;
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (result.type !== 'success') return null;
  if (!result.data.idToken) throw new Error('Google didn’t confirm who you are. Try again.');
  return { provider: 'google', id_token: result.data.idToken };
}

export async function signInWithApple(): Promise<SocialSignIn | null> {
  // Apple puts a hash of this in its token, so the server can tell the token came from this sign-in
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!credential.identityToken) throw new Error('Apple didn’t confirm who you are. Try again.');
    // Apple only shares the name the first time someone signs in to the app
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { provider: 'apple', id_token: credential.identityToken, nonce, name: name || undefined };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw error;
  }
}
