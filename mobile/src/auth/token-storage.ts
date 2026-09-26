import * as SecureStore from 'expo-secure-store';

// The refresh token lives in the iOS Keychain / Android Keystore.
// The web build uses token-storage.web.ts instead.
const KEY = 'triplet.refreshToken';

export function loadRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export function saveRefreshToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(KEY, token);
}

export function clearRefreshToken(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY);
}
