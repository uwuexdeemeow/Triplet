import { useSyncExternalStore } from 'react';

import type { PickedLocation } from '@/components/location-picker';

// Hands a location chosen on the full-screen map back to the form that opened it.
// Expo Router can't return values from a screen, so the picker writes here and closes,
// and the form reads it when it's back on screen.

let picked: PickedLocation | null = null;
const listeners = new Set<() => void>();

export function setPickedLocation(location: PickedLocation | null) {
  picked = location;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePickedLocation(): PickedLocation | null {
  return useSyncExternalStore(subscribe, () => picked, () => picked);
}
