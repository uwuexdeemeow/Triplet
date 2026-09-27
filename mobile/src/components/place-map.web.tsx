import { Feather } from '@expo/vector-icons';
import { forwardRef, useImperativeHandle } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, touchTarget } from '@/theme/tokens';

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

export type MapPlace = Coordinates & {
  id: number;
  name: string;
  planned: boolean;
};

type TripMapProps = {
  places: MapPlace[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  bottomInset?: number;
};

// Without a map, list the pinned places so they can still be opened
export function TripMap({ places, selectedId, onSelect, bottomInset = 0 }: TripMapProps) {
  return (
    <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 16 }]}>
      <Text style={styles.hint}>The map shows in the phone app. Pinned places:</Text>
      {places.map((place) => {
        const selected = place.id === selectedId;
        return (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(selected ? null : place.id)}
            style={[styles.row, selected && styles.rowSelected]}>
            <Feather name="map-pin" size={18} color={place.planned ? colors.teal : colors.coral} />
            <Text style={styles.rowText} numberOfLines={1}>
              {place.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

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
  list: {
    padding: 16,
    gap: 8,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: touchTarget,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  rowSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  rowText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
});
