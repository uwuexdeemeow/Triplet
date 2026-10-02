import 'maplibre-gl/dist/maplibre-gl.css';

import { Feather } from '@expo/vector-icons';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';
import { resolveApiUrl } from '@/api/client';
import { buddyXml } from '@/appearance/buddy';
import { mix } from '@/appearance/looks';
import { personColour } from '@/components/avatar';
import { makeStyles, shadow } from '@/theme/theme';
import { palettes } from '@/theme/tokens';
import { areaKey } from '@/utils/map-area';

// react-native-maps only draws native maps, so the website uses MapLibre instead.
// OpenFreeMap serves the map free with no key; its style credits OpenStreetMap and OpenMapTiles.
// The map is light in both themes, as it's easier to read, so what's drawn on it uses the light colours
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_COLORS = palettes.light;
// Where the site serves MapLibre's background worker; copied there on npm install
const WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';
const STREET_ZOOM = 15.5;
const AREA_ZOOM = 10.5;

type MapLibre = typeof import('maplibre-gl');

export type Coordinates = { latitude: number; longitude: number };

const fill: CSSProperties = { position: 'absolute', inset: 0 };

/** A saved place, marked with the photo or buddy of whoever saved it, or their initial. */
function personPin(person: MapPerson, selected: boolean): HTMLDivElement {
  const size = selected ? 42 : 34;
  const colour = personColour(person.userId, person.name);
  const element = document.createElement('div');
  Object.assign(element.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    overflow: 'hidden',
    boxSizing: 'border-box',
    border: `3px solid ${selected ? '#16181D' : '#fff'}`,
    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
    background: mix(colour, '#FFFFFF', 0.85),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colour,
    font: '600 14px system-ui, sans-serif',
  });
  const photo = resolveApiUrl(person.url);
  const drawing = person.buddy ? buddyXml(person.buddy, colour) : null;
  if (photo) {
    const image = document.createElement('img');
    image.src = photo;
    image.alt = '';
    Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'cover' });
    element.appendChild(image);
  } else if (drawing) {
    // Our own drawings, never anything typed or uploaded
    element.innerHTML = drawing;
    const svg = element.firstElementChild as SVGElement | null;
    if (svg) Object.assign(svg.style, { width: '92%', height: '92%' });
  } else {
    element.textContent = person.name.trim().charAt(0).toUpperCase() || '?';
  }
  return element;
}

/** A round badge with a stop number, for a day's route. */
function numberedPin(label: string, color: string, selected: boolean): HTMLDivElement {
  const size = selected ? 32 : 26;
  const element = document.createElement('div');
  element.textContent = label;
  Object.assign(element.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: color,
    color: '#fff',
    border: '2px solid #fff',
    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '700 13px system-ui, sans-serif',
  });
  return element;
}

/**
 * Creates a map in a div once MapLibre has loaded. MapLibre needs the browser, so it's loaded
 * on demand rather than imported at the top, which would break the static web export.
 */
function useMapLibre(center: Coordinates, zoom: number, interactive: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ map: MapLibreMap; lib: MapLibre } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    import('maplibre-gl').then((module) => {
      const lib = ((module as { default?: MapLibre }).default ?? module) as MapLibre;
      // The worker file is served from public/ (see scripts/copy-maplibre-worker.js)
      lib.setWorkerUrl(WORKER_URL);
      if (cancelled || !container.current) return;
      map = new lib.Map({
        container: container.current,
        style: STYLE_URL,
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

  return { container, map: state?.map ?? null, lib: state?.lib ?? null };
}

/** A small, non-interactive map with a pin, for previews. */
export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  const styles = useStyles();
  const { container, map, lib } = useMapLibre({ latitude, longitude }, STREET_ZOOM - 0.5, false);
  const marker = useRef<MapLibreMarker | null>(null);

  useEffect(() => {
    if (!map || !lib) return;
    map.jumpTo({ center: [longitude, latitude] });
    marker.current?.remove();
    marker.current = new lib.Marker({ color: MAP_COLORS.accent }).setLngLat([longitude, latitude]).addTo(map);
  }, [map, lib, latitude, longitude]);

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
        <Feather name="map-pin" size={40} color={MAP_COLORS.accent} />
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
  // A stop number drawn on the pin, for a day's route
  label?: string;
  // Who saved it, for a saved place: their photo or buddy marks it
  person?: MapPerson;
};

export type MapPerson = { userId: number; name: string; url?: string | null; buddy?: string | null };

export type TripMapProps = {
  places: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Where to look when there are no pins yet, e.g. the trip's destinations
  fallbackArea?: Coordinates[];
  // A spot the user right-clicked or long-pressed, shown as its own pin
  droppedPin?: Coordinates | null;
  onLongPress?: (coordinates: Coordinates) => void;
  // Room taken by whatever floats over the bottom of the map, so pins aren't fitted underneath it
  bottomInset?: number;
  // The same for whatever floats over the top, e.g. a search bar and filters
  topInset?: number;
  // A small preview with nothing floating over it, so it needs less room around the pins
  compact?: boolean;
  // A day's stops in order, joined by a line under the pins
  route?: Coordinates[];
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
  { places, selectedId, onSelect, fallbackArea = [], droppedPin = null, onLongPress, bottomInset = 0, topInset = 0, compact = false, route = [] },
  ref,
) {
  const colors = MAP_COLORS;
  const first = places[0] ?? fallbackArea[0] ?? { latitude: 20, longitude: 0 };
  const { container, map, lib } = useMapLibre(first, places.length ? STREET_ZOOM : fallbackArea.length ? AREA_ZOOM : 1.5, true);
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
    const marker = new lib.Marker({ color: MAP_COLORS.ink }).setLngLat([dropLon, dropLat]).addTo(map);
    marker.getElement().style.zIndex = '2';
    return () => {
      marker.remove();
    };
  }, [map, lib, dropLat, dropLon]);

  // Redraw the pins when they, or the selection, change. The screen rebuilds `places` on every
  // render, so compare what's in it rather than the array itself.
  const markerKey = JSON.stringify([places, selectedId]);
  useEffect(() => {
    if (!map || !lib) return;
    const markers = places.map((place) => {
      const selected = place.id === selectedId;
      const color = selected ? colors.ink : place.planned ? colors.accent : colors.second;
      const custom = place.label
        ? numberedPin(place.label, color, selected)
        : place.person
          ? personPin(place.person, selected)
          : null;
      const marker = new lib.Marker(custom ? { element: custom } : { color })
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

  // The day's route: a dashed line under the pins
  const routeKey = JSON.stringify(route);
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const source = map.getSource('trip-route') as GeoJSONSource | undefined;
      if (route.length < 2) {
        if (map.getLayer('trip-route-line')) map.removeLayer('trip-route-line');
        if (source) map.removeSource('trip-route');
        return;
      }
      const data: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: route.map((point) => [point.longitude, point.latitude]) },
      };
      if (source) {
        source.setData(data);
      } else {
        map.addSource('trip-route', { type: 'geojson', data });
      }
      if (!map.getLayer('trip-route-line')) {
        map.addLayer({
          id: 'trip-route-line',
          type: 'line',
          source: 'trip-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': colors.accent, 'line-width': 3, 'line-dasharray': [3, 1.5] },
        });
      }
    };
    // Adding the line only needs the style itself, not its tiles, so this doesn't wait for isStyleLoaded()
    // (false until every tile is in, with no event after). On a map that has only just been made, adding
    // throws until the style is read, and style.load tries again.
    const tryApply = () => {
      try {
        apply();
      } catch {
        // "Style is not done loading"
      }
    };
    tryApply();
    map.on('style.load', tryApply);
    return () => {
      map.off('style.load', tryApply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, routeKey]);

  // Frame the pins whenever the set of pins changes, e.g. after switching the filter. A day's route
  // counts too: "All" and a day can have the same pins, and the day should still be framed. So does the
  // room at the top, which is only known once the screen has laid out what floats there.
  const pinKey = `${places.map((place) => place.id).join(',')}|${route.length}|${topInset}`;
  const fallbackKey = areaKey(fallbackArea);
  useEffect(() => {
    if (!map || !lib) return;
    // With nothing pinned, show the area instead: one place at city level, or all of them
    const points: Coordinates[] = places.length ? places : fallbackArea;
    if (!points.length) return;
    if (points.length === 1) {
      map.easeTo({ center: [points[0].longitude, points[0].latitude], zoom: places.length ? STREET_ZOOM : AREA_ZOOM, duration: 400 });
      return;
    }
    const bounds = new lib.LngLatBounds();
    points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
    map.fitBounds(bounds, {
      padding: compact ? 24 : { top: topInset ? topInset + 24 : 70, right: 48, bottom: bottomInset + 40, left: 48 },
      maxZoom: places.length ? STREET_ZOOM : AREA_ZOOM,
      duration: 400,
    });
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
