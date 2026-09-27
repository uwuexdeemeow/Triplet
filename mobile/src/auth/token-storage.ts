import * as SecureStore from 'expo-secure-store';

// The refresh token lives in the iOS Keychain / Android Keystore.
// The web build uses token-storage.web.ts instead.
const KEY = 'triplet.refreshToken';
// Guests can't refresh, so their access token is kept instead, until it expires
const GUEST_KEY = 'triplet.guestToken';

// Phones send the refresh token in the request body; the website uses a cookie instead
export const REFRESH_IN_COOKIE = false;

export function loadRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function hasSavedSession(): Promise<boolean> {
  return (await loadRefreshToken()) !== null;
}

export async function saveSession(refreshToken: string | null | undefined): Promise<void> {
  if (refreshToken) await SecureStore.setItemAsync(KEY, refreshToken);
}

export function clearSession(): Promise<void> {
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
