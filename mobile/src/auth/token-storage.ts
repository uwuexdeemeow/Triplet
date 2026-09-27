import * as SecureStore from 'expo-secure-store';

// The refresh token lives in the iOS Keychain / Android Keystore.
// The web build uses token-storage.web.ts instead.
const KEY = 'triplet.refreshToken';
// Guests can't refresh, so their access token is kept instead, until it expires
const GUEST_KEY = 'triplet.guestToken';

export function loadRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export function saveRefreshToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(KEY, token);
}

export function clearRefreshToken(): Promise<void> {
  return SecureStore.deleteItemAsync(KEY);
}

export function loadGuestToken(): Promise<string | null> {
  return SecureStore.getItemAsync(GUEST_KEY);
}

export function saveGuestToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(GUEST_KEY, token);
}

export function clearGuestToken(): Promise<void> {
  return SecureStore.deleteItemAsync(GUEST_KEY);
}
