// SecureStore doesn't exist on the web, so the web build keeps the refresh token in
// localStorage. That's weaker than the phone's keychain, which is fine for development.
const KEY = 'triplet.refreshToken';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export async function loadRefreshToken(): Promise<string | null> {
  return storage()?.getItem(KEY) ?? null;
}

export async function saveRefreshToken(token: string): Promise<void> {
  storage()?.setItem(KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  storage()?.removeItem(KEY);
}
