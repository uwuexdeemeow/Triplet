import { Platform, useWindowDimensions } from 'react-native';

// Screen sizes, by window width:
// - phone: the phone layout everywhere
// - tablet (768+): screens split into columns (the days beside the plan, the saved list beside
//   a post); the website gets a slim icon sidebar instead of the bottom tabs
// - desktop (1024+): the website's full sidebar, three trips to a row, the settings page
// The app on a real tablet uses these too, keeping its own tab bar.
export const TABLET_MIN_WIDTH = 768;
export const DESKTOP_MIN_WIDTH = 1024;
// The trip workspace also shows the map from here
export const MAP_PANEL_MIN_WIDTH = 1180;

export type LayoutSize = 'phone' | 'tablet' | 'desktop';

export function useLayoutSize(): LayoutSize {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_MIN_WIDTH) return 'desktop';
  if (width >= TABLET_MIN_WIDTH) return 'tablet';
  return 'phone';
}

// Room for screens split into columns: tablets and bigger, on the website or in the app
export function useWideLayout(): boolean {
  return useLayoutSize() !== 'phone';
}

// The website's sidebar: slim on a tablet, full on a desktop. The app keeps its tab bar.
export function useSidebar(): 'none' | 'compact' | 'full' {
  const size = useLayoutSize();
  if (Platform.OS !== 'web' || size === 'phone') return 'none';
  return size === 'tablet' ? 'compact' : 'full';
}

export function useShowsMapPanel(): boolean {
  const { width } = useWindowDimensions();
  return width >= MAP_PANEL_MIN_WIDTH;
}
