import { Feather } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

// react-native-maps doesn't run on the web. The web build shows the coordinates instead,
// and the pin picker relies on its search results.

export type Coordinates = { latitude: number; longitude: number };

export function MiniMap({ latitude, longitude, height = 160 }: Coordinates & { height?: number }) {
  return (
    <View style={[styles.box, { height }]}>
      <Feather name="map-pin" size={24} color={colors.teal} />
      <Text style={styles.text}>
        Pinned at {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Text>
      <Text style={styles.hint}>The map shows in the phone app</Text>
    </View>
  );
}

export type PickerMapHandle = {
  moveTo: (coordinates: Coordinates) => void;
};

type PickerMapProps = {
  initial: Coordinates;
  onCenterChange: (center: Coordinates) => void;
  zoomedOut?: boolean;
};

export const PickerMap = forwardRef<PickerMapHandle, PickerMapProps>(function PickerMap({ onCenterChange }, ref) {
  // Without a map, "moving" just means taking the chosen search result's location
  useImperativeHandle(ref, () => ({ moveTo: (coordinates) => onCenterChange(coordinates) }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.box]}>
      <Feather name="map" size={32} color={colors.muted} />
      <Text style={styles.text}>Search for the place and pick a result</Text>
      <Text style={styles.hint}>Dragging a pin on the map works in the phone app</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderRadius: 16,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
  },
});
