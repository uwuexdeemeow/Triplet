import { Feather } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type LongPressEvent, type MapPressEvent, type Region } from 'react-native-maps';
import { makeStyles, shadow } from '@/theme/theme';
import { fonts, palettes } from '@/theme/tokens';
import { areaKey } from '@/utils/map-area';

export type Coordinates = { latitude: number; longitude: number };

// The map is light in both themes, as it's easier to read, so what's drawn on it uses the light
// colours. Apple Maps (iOS) would otherwise follow the phone's dark mode.
const LIGHT_MAP_PROPS = { userInterfaceStyle: 'light' } as const;
const MAP_COLORS = palettes.light;

// Close enough to see the streets around a restaurant
const STREET_ZOOM = { latitudeDelta: 0.008, longitudeDelta: 0.008 };

/** A small, non-interactive map with a pin, for previews. */
export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  const styles = useStyles();
  const colors = MAP_COLORS;
  return (
    <View style={[styles.mini, { height }]} pointerEvents="none" accessibilityLabel="Map showing the pinned location">
      <MapView
        {...LIGHT_MAP_PROPS}
        style={StyleSheet.absoluteFill}
        region={{ latitude, longitude, ...STREET_ZOOM }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}>
        <Marker coordinate={{ latitude, longitude }} pinColor={colors.accent} />
      </MapView>
    </View>
  );
}

export type PickerMapHandle = {
  moveTo: (coordinates: Coordinates) => void;
};

type PickerMapProps = {
  initial: Coordinates;
  // Called when the user stops dragging, with the point under the centre pin
  onCenterChange: (center: Coordinates) => void;
  zoomedOut?: boolean;
};

/** A full map with a pin fixed in the middle: drag the map to move the pin. */
export const PickerMap = forwardRef<PickerMapHandle, PickerMapProps>(function PickerMap(
  { initial, onCenterChange, zoomedOut = false },
  ref,
) {
  const styles = useStyles();
  const colors = MAP_COLORS;
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => mapRef.current?.animateToRegion({ ...coordinates, ...STREET_ZOOM }, 400),
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        {...LIGHT_MAP_PROPS}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...initial, ...(zoomedOut ? { latitudeDelta: 0.3, longitudeDelta: 0.3 } : STREET_ZOOM) }}
        onRegionChangeComplete={(region: Region) =>
          onCenterChange({ latitude: region.latitude, longitude: region.longitude })
        }
        // Tapping drops the pin there: the map slides so the tapped spot sits under the pin
        onPress={(event: MapPressEvent) => mapRef.current?.animateCamera({ center: event.nativeEvent.coordinate }, { duration: 250 })}
        toolbarEnabled={false}
      />
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
  // A stop number drawn on the pin, for a day's route
  label?: string;
};

export type TripMapProps = {
  places: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Where to look when there are no pins yet, e.g. the trip's destinations
  fallbackArea?: Coordinates[];
  // A spot the user long-pressed, shown as its own pin
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

// Around the pins on a small preview map
const COMPACT_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

// A city's worth of map, for when there's nothing pinned yet
const AREA_ZOOM = { latitudeDelta: 0.18, longitudeDelta: 0.18 };

/**
 * Every pin in the trip. Tapping a pin selects it, tapping the map clears the selection,
 * and long-pressing drops a pin to add something there.
 */
export type TripMapHandle = {
  // Fly to a spot at street level, e.g. a search result
  moveTo: (coordinates: Coordinates) => void;
};

export const TripMap = forwardRef<TripMapHandle, TripMapProps>(function TripMap(
  { places, selectedId, onSelect, fallbackArea = [], droppedPin = null, onLongPress, bottomInset = 0, topInset = 0, compact = false, route = [] },
  ref,
) {
  const styles = useStyles();
  const colors = MAP_COLORS;
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => mapRef.current?.animateToRegion({ ...coordinates, ...STREET_ZOOM }, 500),
  }));

  // Frame the pins whenever the set of pins changes, e.g. after switching the filter. A day's route
  // counts too: "All" and a day can have the same pins, and the day should still be framed. So does the
  // room at the top, which is only known once the screen has laid out what floats there.
  const pinKey = `${places.map((place) => place.id).join(',')}|${route.length}|${topInset}`;
  const fallbackKey = areaKey(fallbackArea);
  const padding = compact ? COMPACT_PADDING : { top: topInset ? topInset + 24 : 60, right: 48, bottom: bottomInset + 40, left: 48 };
  useEffect(() => {
    if (!ready) return;
    if (!places.length) {
      if (fallbackArea.length === 1) mapRef.current?.animateToRegion({ ...fallbackArea[0], ...AREA_ZOOM }, 400);
      else if (fallbackArea.length > 1)
        mapRef.current?.fitToCoordinates(fallbackArea, {
          edgePadding: padding,
          animated: true,
        });
    } else if (places.length === 1) {
      mapRef.current?.animateToRegion({ latitude: places[0].latitude, longitude: places[0].longitude, ...STREET_ZOOM }, 400);
    } else {
      mapRef.current?.fitToCoordinates(places, {
        edgePadding: padding,
        animated: true,
      });
    }
    // Only refit for a different set of pins, not when a pin is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey, fallbackKey]);

  return (
    <MapView
      {...LIGHT_MAP_PROPS}
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      onMapReady={() => setReady(true)}
      onPress={(event: MapPressEvent) => {
        // Android reports marker taps to the map as well
        if (event.nativeEvent.action !== 'marker-press') onSelect(null);
      }}
      onLongPress={(event: LongPressEvent) => onLongPress?.(event.nativeEvent.coordinate)}
      toolbarEnabled={false}>
      {route.length > 1 ? (
        <Polyline coordinates={route} strokeColor={colors.accent} strokeWidth={3} lineJoin="round" lineDashPattern={[10, 5]} />
      ) : null}
      {places.map((place) => {
        const selected = place.id === selectedId;
        const color = selected ? colors.ink : place.planned ? colors.accent : colors.second;
        return (
          <Marker
            // Android only picks up a new pin colour on a fresh marker
            key={`${place.id}-${selected ? 'selected' : place.planned ? 'planned' : 'saved'}-${place.label ?? ''}`}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            title={place.name}
            // A numbered stop is a round badge; other pins keep the default pin
            pinColor={place.label ? undefined : color}
            anchor={place.label ? { x: 0.5, y: 0.5 } : undefined}
            zIndex={selected ? 1 : 0}
            onPress={() => onSelect(place.id)}>
            {place.label ? (
              <View style={[styles.badge, { backgroundColor: color }]}>
                <Text style={styles.badgeText}>{place.label}</Text>
              </View>
            ) : null}
          </Marker>
        );
      })}
      {droppedPin ? (
        <Marker
          key={`dropped-${droppedPin.latitude},${droppedPin.longitude}`}
          coordinate={droppedPin}
          pinColor={colors.ink}
          zIndex={2}
        />
      ) : null}
    </MapView>
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
  badge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  pinShadow: {
    width: 14,
    height: 5,
    borderRadius: 3,
    backgroundColor: shadow(colors, 0.25),
  },
}));
