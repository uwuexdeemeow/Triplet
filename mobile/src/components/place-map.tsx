import { Feather } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type LongPressEvent, type MapPressEvent, type Region } from 'react-native-maps';

import { colors } from '@/theme/tokens';

export type Coordinates = { latitude: number; longitude: number };

// Close enough to see the streets around a restaurant
const STREET_ZOOM = { latitudeDelta: 0.008, longitudeDelta: 0.008 };

/** A small, non-interactive map with a pin, for previews. */
export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  return (
    <View style={[styles.mini, { height }]} pointerEvents="none" accessibilityLabel="Map showing the pinned location">
      <MapView
        style={StyleSheet.absoluteFill}
        region={{ latitude, longitude, ...STREET_ZOOM }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}>
        <Marker coordinate={{ latitude, longitude }} pinColor={colors.teal} />
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
  const mapRef = useRef<MapView>(null);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => mapRef.current?.animateToRegion({ ...coordinates, ...STREET_ZOOM }, 400),
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
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
        <Feather name="map-pin" size={40} color={colors.teal} />
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
  // A spot the user long-pressed, shown as its own pin
  droppedPin?: Coordinates | null;
  onLongPress?: (coordinates: Coordinates) => void;
  // Room taken by whatever floats over the bottom of the map, so pins aren't fitted underneath it
  bottomInset?: number;
};

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
  { places, selectedId, onSelect, fallbackCenter = null, droppedPin = null, onLongPress, bottomInset = 0 },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    moveTo: (coordinates) => mapRef.current?.animateToRegion({ ...coordinates, ...STREET_ZOOM }, 500),
  }));

  // Frame the pins whenever the set of pins changes, e.g. after switching the filter
  const pinKey = places.map((place) => place.id).join(',');
  const fallbackKey = fallbackCenter ? `${fallbackCenter.latitude},${fallbackCenter.longitude}` : '';
  useEffect(() => {
    if (!ready) return;
    if (!places.length) {
      if (fallbackCenter) mapRef.current?.animateToRegion({ ...fallbackCenter, ...AREA_ZOOM }, 400);
    } else if (places.length === 1) {
      mapRef.current?.animateToRegion({ latitude: places[0].latitude, longitude: places[0].longitude, ...STREET_ZOOM }, 400);
    } else {
      mapRef.current?.fitToCoordinates(places, {
        edgePadding: { top: 60, right: 40, bottom: bottomInset + 40, left: 40 },
        animated: true,
      });
    }
    // Only refit for a different set of pins, not when a pin is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey, fallbackKey]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      onMapReady={() => setReady(true)}
      onPress={(event: MapPressEvent) => {
        // Android reports marker taps to the map as well
        if (event.nativeEvent.action !== 'marker-press') onSelect(null);
      }}
      onLongPress={(event: LongPressEvent) => onLongPress?.(event.nativeEvent.coordinate)}
      toolbarEnabled={false}>
      {places.map((place) => {
        const selected = place.id === selectedId;
        return (
          <Marker
            // Android only picks up a new pin colour on a fresh marker
            key={`${place.id}-${selected ? 'selected' : place.planned ? 'planned' : 'saved'}`}
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            title={place.name}
            pinColor={selected ? colors.ink : place.planned ? colors.teal : colors.coral}
            zIndex={selected ? 1 : 0}
            onPress={() => onSelect(place.id)}
          />
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

const styles = StyleSheet.create({
  mini: {
    borderRadius: 16,
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
    backgroundColor: 'rgba(29, 27, 24, 0.25)',
  },
});
