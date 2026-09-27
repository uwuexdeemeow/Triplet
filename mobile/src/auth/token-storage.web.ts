// On the website the refresh token is in an HttpOnly cookie the API sets, which page scripts
// can't read, so a script injected into the page can't steal it. All this file keeps is a note
// that there is a session, so a signed-out visitor doesn't wait on a refresh that can't work.
const KEY = 'triplet.signedIn';
// A guest's token only opens one trip for a day, and has no refresh token to protect
const GUEST_KEY = 'triplet.guestToken';

export const REFRESH_IN_COOKIE = true;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// The cookie is sent by the browser, never read here
export async function loadRefreshToken(): Promise<string | null> {
  return null;
}

export async function hasSavedSession(): Promise<boolean> {
  return storage()?.getItem(KEY) === '1';
}

export async function saveSession(): Promise<void> {
  storage()?.setItem(KEY, '1');
}

export async function clearSession(): Promise<void> {
  storage()?.removeItem(KEY);
}

export async function loadGuestToken(): Promise<string | null> {
  return storage()?.getItem(GUEST_KEY) ?? null;
}

export async function saveGuestToken(token: string): Promise<void> {
  storage()?.setItem(GUEST_KEY, token);
}

export async function clearGuestToken(): Promise<void> {
  storage()?.removeItem(GUEST_KEY);
}

// Earlier versions kept the refresh token itself here, where page scripts could read it
storage()?.removeItem('triplet.refreshToken');
