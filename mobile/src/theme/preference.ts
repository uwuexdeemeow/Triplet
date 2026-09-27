import * as SecureStore from 'expo-secure-store';

// Light, dark, or whatever the phone is set to. The web build uses preference.web.ts.
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'triplet.theme';

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const value = await SecureStore.getItemAsync(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, value);
  } catch {
    // Not being remembered is fine; the choice still applies until the app closes
  }
}
