import { Platform, useWindowDimensions } from 'react-native';

// From this width the website gets its desktop layout: a sidebar instead of the bottom tabs, and
// screens that use the room (the plan and its map side by side). Phones never do.
export const WIDE_MIN_WIDTH = 1024;
// The trip workspace also shows the map from here
export const MAP_PANEL_MIN_WIDTH = 1180;

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WIDE_MIN_WIDTH;
}

export function useShowsMapPanel(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= MAP_PANEL_MIN_WIDTH;
}
