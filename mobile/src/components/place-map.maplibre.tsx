import { Feather } from '@expo/vector-icons';
import { Camera, GeoJSONSource, Layer, Map, ViewAnnotation, type CameraRef, type LngLat } from '@maplibre/maplibre-react-native';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import type { Coordinates, MapPlace, PickerMapHandle, TripMapHandle, TripMapProps } from '@/components/place-map.google';
import { makeStyles, shadow } from '@/theme/theme';
import { fonts, palettes } from '@/theme/tokens';
import { areaKey } from '@/utils/map-area';

// Phone maps in the app's own builds: MapLibre with free OpenFreeMap tiles, the same maps the
// website shows. No Google key or billing needed. (Expo Go uses place-map.google.tsx instead.)
// The map is light in both themes, as it's easier to read, so what's drawn on it uses the light colours
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_COLORS = palettes.light;
const STREET_ZOOM = 15.5;
const AREA_ZOOM = 10.5;

const toLngLat = ({ latitude, longitude }: Coordinates): LngLat => [longitude, latitude];

/** A round pin: the plan's colour inside a ring in the card colour, bigger when selected. A stop shows its number. */
function Pin({ color, selected = false, label }: { color: string; selected?: boolean; label?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.pin, { backgroundColor: color, borderColor: MAP_COLORS.surface }, label ? styles.pinNumbered : null, selected && (label ? styles.pinNumberedSelected : styles.pinSelected)]}>
      {label ? <Text style={styles.pinLabel}>{label}</Text> : null}
    </View>
  );
}

/** A small, non-interactive map with a pin, for previews. */
export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  const styles = useStyles();
  const center = toLngLat({ latitude, longitude });

  return (
    <View style={[styles.mini, { height }]} pointerEvents="none" accessibilityLabel="Map showing the pinned location">
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={STYLE_URL}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        logo={false}
        attributionPosition={{ bottom: 4, right: 4 }}>
        <Camera center={center} zoom={STREET_ZOOM - 0.5} duration={0} />
        <ViewAnnotation id="pin" lngLat={center}>
          <Pin color={MAP_COLORS.accent} />
        </ViewAnnotation>
      </Map>
    </View>
  );
}

type PickerMapProps = {
  initial: Coordinates;
  // Called when the map stops moving, with the point under the centre pin
  onCenterChange: (center: Coordinates) => void;
  zoomedOut?: boolean;
};

/** A full map with a pin fixed in the middle: drag the map, or tap a spot, to move the pin. */
export const PickerMap = forwardRef<PickerMapHandle, PickerMapProps>(function PickerMap(
  { initial, onCenterChange, zoomedOut = false },
  ref,
) {
  const styles = useStyles();
  const camera = useRef<CameraRef>(null);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => camera.current?.easeTo({ center: toLngLat(coordinates), zoom: STREET_ZOOM, duration: 400 }),
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={STYLE_URL}
        logo={false}
        compass={false}
        touchPitch={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        onRegionDidChange={(event) => {
          const [longitude, latitude] = event.nativeEvent.center;
          onCenterChange({ latitude, longitude });
        }}
        // Tapping drops the pin there: the map slides so the tapped spot sits under the pin
        onPress={(event) => camera.current?.easeTo({ center: event.nativeEvent.lngLat, duration: 250 })}>
        <Camera
          ref={camera}
          initialViewState={{ center: toLngLat(initial), zoom: zoomedOut ? AREA_ZOOM : STREET_ZOOM }}
        />
      </Map>
      {/* The pin stays still while the map moves under it */}
      <View pointerEvents="none" style={styles.centerPin}>
        <Feather name="map-pin" size={40} color={MAP_COLORS.accent} />
        <View style={styles.pinShadow} />
      </View>
    </View>
  );
});

/**
 * Every pin in the trip. Tapping a pin selects it, tapping the map clears the selection,
 * and long-pressing drops a pin to add something there.
 */
export const TripMap = forwardRef<TripMapHandle, TripMapProps>(function TripMap(
  { places, selectedId, onSelect, fallbackArea = [], droppedPin = null, onLongPress, bottomInset = 0, topInset = 0, compact = false, route = [] },
  ref,
) {
  const colors = MAP_COLORS;
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  // A tap on a pin can also reach the map underneath; ignore that map tap
  const pinTappedAt = useRef(0);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => camera.current?.easeTo({ center: toLngLat(coordinates), zoom: STREET_ZOOM, duration: 500 }),
  }));

  // Frame the pins whenever the set of pins changes, e.g. after switching the filter. A day's route
  // counts too: "All" and a day can have the same pins, and the day should still be framed. So does the
  // room at the top, which is only known once the screen has laid out what floats there.
  const pinKey = `${places.map((place) => place.id).join(',')}|${route.length}|${topInset}`;
  const fallbackKey = areaKey(fallbackArea);
  useEffect(() => {
    if (!loaded) return;
    // With nothing pinned, show the area instead: one place at city level, or all of them
    const points: Coordinates[] = places.length ? places : fallbackArea;
    if (!points.length) return;
    if (points.length === 1) {
      camera.current?.easeTo({ center: toLngLat(points[0]), zoom: places.length ? STREET_ZOOM : AREA_ZOOM, duration: 400 });
      return;
    }
    const lngs = points.map((point) => point.longitude);
    const lats = points.map((point) => point.latitude);
    camera.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], {
      padding: compact ? { top: 24, right: 24, bottom: 24, left: 24 } : { top: topInset ? topInset + 24 : 90, right: 48, bottom: bottomInset + 40, left: 48 },
      duration: 400,
    });
    // Only refit for a different set of pins, not when a pin is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pinKey, fallbackKey]);

  const color = (place: MapPlace) => (place.id === selectedId ? colors.ink : place.planned ? colors.accent : colors.second);

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={STYLE_URL}
      logo={false}
      compass={false}
      touchPitch={false}
      attributionPosition={{ top: 8, right: 8 }}
      onDidFinishLoadingMap={() => setLoaded(true)}
      onPress={() => {
        if (Date.now() - pinTappedAt.current > 300) onSelect(null);
      }}
      onLongPress={(event) => {
        const [longitude, latitude] = event.nativeEvent.lngLat;
        onLongPress?.({ latitude, longitude });
      }}>
      <Camera ref={camera} initialViewState={{ center: [0, 20], zoom: 1.5 }} />
      {route.length > 1 ? (
        // Under the pins, which are views drawn on top of the map
        <GeoJSONSource
          id="trip-route"
          data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(toLngLat) } }}>
          <Layer
            id="trip-route-line"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': colors.accent, 'line-width': 3, 'line-dasharray': [3, 1.5] }}
          />
        </GeoJSONSource>
      ) : null}
      {places.map((place) => (
        <ViewAnnotation
          key={place.id}
          id={place.id}
          lngLat={toLngLat(place)}
          title={place.name}
          onPress={() => {
            pinTappedAt.current = Date.now();
            onSelect(place.id);
          }}>
          {place.person && !place.label ? (
            <PersonPin person={place.person} selected={place.id === selectedId} />
          ) : (
            <Pin color={color(place)} selected={place.id === selectedId} label={place.label} />
          )}
        </ViewAnnotation>
      ))}
      {droppedPin ? (
        <ViewAnnotation id="dropped" lngLat={toLngLat(droppedPin)}>
          <Pin color={colors.ink} selected />
        </ViewAnnotation>
      ) : null}
    </Map>
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
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: colors.surface,
    boxShadow: `0 2px 6px ${shadow(colors, 0.35)}`,
  },
  pinNumbered: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinLabel: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  pinSelected: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  pinNumberedSelected: {
    width: 32,
    height: 32,
    borderRadius: 16,
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

/** A saved place, marked with the photo or buddy of whoever saved it. */
function PersonPin({ person, selected }: { person: { userId: number; name: string; url?: string | null; buddy?: string | null }; selected: boolean }) {
  const size = selected ? 42 : 34;
  return (
    <Avatar
      name={person.name}
      url={person.url}
      buddy={person.buddy}
      userId={person.userId}
      size={size}
      style={{ borderWidth: 3, borderColor: selected ? '#16181D' : '#FFFFFF', boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)' }}
    />
  );
}
