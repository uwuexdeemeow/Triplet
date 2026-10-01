import { Linking, Platform } from 'react-native';

// A plan or place to get directions to (or from). Pins are the most precise; without one, the
// maps app searches for the name and address instead.
export type Stop = {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // Where the trip is, e.g. "Tokyo". Without a pin, the search includes it, or a typo like
  // "gayland" finds whatever matches anywhere in the world, usually near the person instead.
  area?: string | null;
};

export function hasPin(stop: Pick<Stop, 'latitude' | 'longitude'>): boolean {
  return stop.latitude != null && stop.longitude != null;
}

function where(stop: Stop): string {
  if (stop.latitude != null && stop.longitude != null) return `${stop.latitude},${stop.longitude}`;
  const parts = [stop.name, stop.address].filter(Boolean) as string[];
  const area = stop.area?.trim();
  if (area && !parts.some((part) => part.toLowerCase().includes(area.toLowerCase()))) parts.push(area);
  return parts.join(', ');
}

// How to get there; left out, the maps app uses whatever the person usually picks
export type TravelMode = 'walk' | 'transit';

/**
 * The maps link for directions to `to`, from `from` or else wherever the person is now.
 * iPhones open Apple Maps, their built-in maps; everywhere else opens Google Maps, which on a
 * phone opens its app if installed and otherwise its website.
 */
export function directionsUrl(to: Stop, from?: Stop, mode?: TravelMode): string {
  if (Platform.OS === 'ios') {
    const params = new URLSearchParams({ daddr: where(to) });
    if (from) params.set('saddr', where(from));
    if (mode) params.set('dirflg', mode === 'walk' ? 'w' : 'r');
    return `https://maps.apple.com/?${params}`;
  }
  // https://developers.google.com/maps/documentation/urls/get-started#directions-action
  const params = new URLSearchParams({ api: '1', destination: where(to) });
  if (from) params.set('origin', where(from));
  if (mode) params.set('travelmode', mode === 'walk' ? 'walking' : 'transit');
  return `https://www.google.com/maps/dir/?${params}`;
}

export function openDirections(to: Stop, from?: Stop, mode?: TravelMode) {
  // On the website this opens a new tab, so the trip stays open
  Linking.openURL(directionsUrl(to, from, mode)).catch(() => {});
}
