import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { loadThemePreference, saveThemePreference, type ThemePreference } from '@/theme/preference';
import { palettes, type ColorScheme, type Palette } from '@/theme/tokens';

type Theme = {
  // What's showing now
  scheme: ColorScheme;
  colors: Palette;
  // What the user picked in Profile
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
  // False until the saved choice has loaded, so the app doesn't flash the wrong theme
  ready: boolean;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadThemePreference().then((saved) => {
      if (cancelled) return;
      setPreferenceState(saved);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    saveThemePreference(value);
  }, []);

  const scheme: ColorScheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo(
    () => ({ scheme, colors: palettes[scheme], preference, setPreference, ready }),
    [scheme, preference, setPreference, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}

/**
 * Styles that follow the theme. Use in place of StyleSheet.create:
 *
 *   const useStyles = makeStyles((colors) => ({ card: { backgroundColor: colors.surface } }));
 *   // in a component
 *   const styles = useStyles();
 *
 * Each theme's styles are built once and reused.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors: Palette) => T): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles() {
    const { scheme } = useTheme();
    return (cache[scheme] ??= StyleSheet.create(factory(palettes[scheme])));
  };
}

// A see-through version of the theme's shadow tint, e.g. shadow(colors, 0.12)
export function shadow(colors: Palette, opacity: number): string {
  return `rgba(${colors.shadow}, ${opacity})`;
}
