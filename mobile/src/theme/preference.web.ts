// SecureStore doesn't exist on the web, so the theme choice lives in localStorage
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'triplet.theme';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const value = storage()?.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  try {
    storage()?.setItem(KEY, value);
  } catch {
    // Not being remembered is fine; the choice still applies until the page reloads
  }
}
