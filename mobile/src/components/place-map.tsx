import { Feather } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

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
