import 'maplibre-gl/dist/maplibre-gl.css';

import { Feather } from '@expo/vector-icons';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';
import { makeStyles, shadow, useTheme } from '@/theme/theme';

// react-native-maps only draws native maps, so the website uses MapLibre instead.
// OpenFreeMap serves the map free with no key; its style credits OpenStreetMap and OpenMapTiles.
// A dark map in dark mode, so it doesn't glare against the rest of the app
const STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;
const STREET_ZOOM = 15.5;
const AREA_ZOOM = 10.5;

type MapLibre = typeof import('maplibre-gl');

export type Coordinates = { latitude: number; longitude: number };

const fill: CSSProperties = { position: 'absolute', inset: 0 };

/**
 * Creates a map in a div once MapLibre has loaded. MapLibre needs the browser, so it's loaded
 * on demand rather than imported at the top, which would break the static web export.
 */
function useMapLibre(center: Coordinates, zoom: number, interactive: boolean) {
  const { scheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ map: MapLibreMap; lib: MapLibre } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    import('maplibre-gl').then((module) => {
      const lib = ((module as { default?: MapLibre }).default ?? module) as MapLibre;
      if (cancelled || !container.current) return;
      map = new lib.Map({
        container: container.current,
        style: STYLE_URLS[scheme],
        center: [center.longitude, center.latitude],
        zoom,
        interactive,
        attributionControl: { compact: true },
      });
      setState({ map, lib });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // The map is created once; later changes move it instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching theme swaps the map's look; pins are separate and stay put
  const map = state?.map ?? null;
  const shownScheme = useRef(scheme);
  useEffect(() => {
    if (!map || shownScheme.current === scheme) return;
    shownScheme.current = scheme;
    map.setStyle(STYLE_URLS[scheme]);
  }, [map, scheme]);

  return { container, map, lib: state?.lib ?? null };
}

/** A small, non-interactive map with a pin, for previews. */
export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { container, map, lib } = useMapLibre({ latitude, longitude }, STREET_ZOOM - 0.5, false);
  const marker = useRef<MapLibreMarker | null>(null);

  useEffect(() => {
    if (!map || !lib) return;
    map.jumpTo({ center: [longitude, latitude] });
    // A fresh marker when the theme changes, since a marker's colour is fixed once made
    marker.current?.remove();
    marker.current = new lib.Marker({ color: colors.accent }).setLngLat([longitude, latitude]).addTo(map);
  }, [map, lib, latitude, longitude, colors.accent]);

  return (
    <View style={[styles.mini, { height }]} accessibilityLabel="Map showing the pinned location">
      <div ref={container} style={fill} />
    </View>
  );
}

export type PickerMapHandle = {
  moveTo: (coordinates: Coordinates) => void;
};

type PickerMapProps = {
  initial: Coordinates;
  // Called when the map stops moving, with the point under the centre pin
  onCenterChange: (center: Coordinates) => void;
  zoomedOut?: boolean;
};

/** A full map with a pin fixed in the middle: drag the map, or click a spot, to move the pin. */
export const PickerMap = forwardRef<PickerMapHandle, PickerMapProps>(function PickerMap(
  { initial, onCenterChange, zoomedOut = false },
  ref,
) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { container, map } = useMapLibre(initial, zoomedOut ? AREA_ZOOM : STREET_ZOOM, true);
  const reportCenter = useEffectEvent((center: Coordinates) => onCenterChange(center));

  useEffect(() => {
    if (!map) return;
    const report = () => {
      const center = map.getCenter();
      reportCenter({ latitude: center.lat, longitude: center.lng });
    };
    // Clicking drops the pin there: the map slides so the clicked spot sits under the pin
    const clicked = (event: { lngLat: { lng: number; lat: number } }) =>
      map.easeTo({ center: [event.lngLat.lng, event.lngLat.lat], duration: 250 });

    map.on('moveend', report);
    map.on('click', clicked);
    return () => {
      map.off('moveend', report);
      map.off('click', clicked);
    };
  }, [map]);

  useImperativeHandle(
    ref,
    () => ({
      moveTo: (coordinates) =>
        map?.easeTo({ center: [coordinates.longitude, coordinates.latitude], zoom: STREET_ZOOM, duration: 400 }),
    }),
    [map],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <div ref={container} style={fill} />
      {/* The pin stays still while the map moves under it */}
      <View pointerEvents="none" style={styles.centerPin}>
        <Feather name="map-pin" size={40} color={colors.accent} />
        <View style={styles.pinShadow} />
      </View>
    </View>
  );
});

export type MapPlace = Coordinates & {
  // "activity-12" or "place-5": the map shows both plans and saved places
  id: string;
  name: string;
  planned: boolean;
};

export type TripMapProps = {
  places: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Where to look when there are no pins yet, e.g. the trip's destination
  fallbackCenter?: Coordinates | null;
  // A spot the user right-clicked or long-pressed, shown as its own pin
  droppedPin?: Coordinates | null;
  onLongPress?: (coordinates: Coordinates) => void;
  // Room taken by whatever floats over the bottom of the map, so pins aren't fitted underneath it
  bottomInset?: number;
};

/**
 * Every pin in the trip. Clicking a pin selects it, clicking the map clears the selection, and
 * right-clicking (a long press on touch screens) drops a pin to add something there.
 */
export type TripMapHandle = {
  // Fly to a spot at street level, e.g. a search result
  moveTo: (coordinates: Coordinates) => void;
};

export const TripMap = forwardRef<TripMapHandle, TripMapProps>(function TripMap(
  { places, selectedId, onSelect, fallbackCenter = null, droppedPin = null, onLongPress, bottomInset = 0 },
  ref,
) {
  const { colors } = useTheme();
  const first = places[0] ?? fallbackCenter ?? { latitude: 20, longitude: 0 };
  const { container, map, lib } = useMapLibre(first, places.length ? STREET_ZOOM : fallbackCenter ? AREA_ZOOM : 1.5, true);
  const select = useEffectEvent((id: string | null) => onSelect(id));
  const drop = useEffectEvent((coordinates: Coordinates) => onLongPress?.(coordinates));

  useImperativeHandle(
    ref,
    () => ({
      moveTo: (coordinates) =>
        map?.easeTo({ center: [coordinates.longitude, coordinates.latitude], zoom: STREET_ZOOM, duration: 500 }),
    }),
    [map],
  );

  // Clicking empty map clears the selection. Marker clicks are handled on the markers.
  useEffect(() => {
    if (!map) return;
    const clicked = (event: { originalEvent: MouseEvent }) => {
      const target = event.originalEvent.target as HTMLElement | null;
      if (!target?.closest('.maplibregl-marker')) select(null);
    };
    // Right-click, or a long press on a touch screen
    const pressed = (event: { lngLat: { lng: number; lat: number }; preventDefault: () => void }) => {
      event.preventDefault();
      drop({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    };
    map.on('click', clicked);
    map.on('contextmenu', pressed);
    return () => {
      map.off('click', clicked);
      map.off('contextmenu', pressed);
    };
  }, [map]);

  const dropLat = droppedPin?.latitude;
  const dropLon = droppedPin?.longitude;
  useEffect(() => {
    if (!map || !lib || dropLat === undefined || dropLon === undefined) return;
    const marker = new lib.Marker({ color: colors.ink }).setLngLat([dropLon, dropLat]).addTo(map);
    marker.getElement().style.zIndex = '2';
    return () => {
      marker.remove();
    };
  }, [map, lib, dropLat, dropLon, colors.ink]);

  // Redraw the pins when they, or the selection, change. The screen rebuilds `places` on every
  // render, so compare what's in it rather than the array itself.
  const markerKey = JSON.stringify([places, selectedId, colors.accent]);
  useEffect(() => {
    if (!map || !lib) return;
    const markers = places.map((place) => {
      const selected = place.id === selectedId;
      const marker = new lib.Marker({ color: selected ? colors.ink : place.planned ? colors.accent : colors.second })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      const element = marker.getElement();
      element.style.cursor = 'pointer';
      element.style.zIndex = selected ? '1' : '0';
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', place.name);
      element.title = place.name;
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        select(place.id);
      });
      return marker;
    });
    return () => markers.forEach((marker) => marker.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lib, markerKey]);

  // Frame the pins whenever the set of pins changes, e.g. after switching the filter
  const pinKey = places.map((place) => place.id).join(',');
  const fallbackKey = fallbackCenter ? `${fallbackCenter.latitude},${fallbackCenter.longitude}` : '';
  useEffect(() => {
    if (!map || !lib) return;
    if (!places.length) {
      if (fallbackCenter) map.easeTo({ center: [fallbackCenter.longitude, fallbackCenter.latitude], zoom: AREA_ZOOM, duration: 400 });
      return;
    }
    if (places.length === 1) {
      map.easeTo({ center: [places[0].longitude, places[0].latitude], zoom: STREET_ZOOM, duration: 400 });
      return;
    }
    const bounds = new lib.LngLatBounds();
    places.forEach((place) => bounds.extend([place.longitude, place.latitude]));
    map.fitBounds(bounds, { padding: { top: 70, right: 40, bottom: bottomInset + 40, left: 40 }, maxZoom: STREET_ZOOM, duration: 400 });
    // Only refit for a different set of pins, not when a pin is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lib, pinKey, fallbackKey]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <div ref={container} style={fill} />
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  mini: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.chip,
  },
  centerPin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    alignItems: 'center',
    // The pin's point, not its middle, marks the spot
    transform: [{ translateX: -20 }, { translateY: -40 }],
  },
  pinShadow: {
    width: 14,
    height: 5,
    borderRadius: 3,
    backgroundColor: shadow(colors, 0.25),
  },
}));
