import { TurboModuleRegistry } from 'react-native';

import type * as Maps from '@/components/place-map.google';

// Which map to draw on phones:
// - The app's own builds include MapLibre, which draws free OpenFreeMap maps like the website
//   and needs no Google key or billing.
// - Expo Go doesn't include MapLibre, so it keeps react-native-maps (Apple and Google maps,
//   using Expo Go's own key).
// MapLibre can't even be imported without its native part, so it's only loaded when present.
// The website uses place-map.web.tsx.
export const usesMapLibre = TurboModuleRegistry.get('MLRNCameraModule') != null;

const maps: typeof Maps = usesMapLibre
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/components/place-map.maplibre')
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/components/place-map.google');

export const { MiniMap, PickerMap, TripMap } = maps;
export type {
  Coordinates,
  MapPlace,
  PickerMapHandle,
  TripMapHandle,
  TripMapProps,
} from '@/components/place-map.google';
