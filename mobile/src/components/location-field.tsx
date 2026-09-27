import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { MiniMap } from '@/components/place-map';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing, touchTarget } from '@/theme/tokens';
import { setPickedLocation, usePickedLocation } from '@/utils/picked-location';

type Suggestion = Schemas['PlaceSearchResult'];

export type Pin = {
  latitude: number;
  longitude: number;
  address: string | null;
};

// Wait for a pause in typing before asking for suggestions
const DEBOUNCE_MS = 350;

type LocationFieldProps = {
  tripId: number;
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  error?: string;
  pin: Pin | null;
  onPinChange: (pin: Pin | null) => void;
  // What's happening there, shown on the map picker
  title?: string;
};

/** A location typed with suggestions, plus a map preview that opens the pin picker. */
export function LocationField({
  tripId,
  label,
  placeholder,
  value,
  onChangeText,
  onBlur,
  error,
  pin,
  onPinChange,
  title,
}: LocationFieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const awaitingPick = useRef(false);
  const picked = usePickedLocation();

  // Ask for suggestions once typing pauses
  useEffect(() => {
    const text = value.trim();
    const timer = setTimeout(() => setQuery(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const suggestions = useQuery({
    queryKey: ['trips', tripId, 'suggest', query],
    queryFn: () => api<Suggestion[]>(`/trips/${tripId}/places/suggest`, { query: { q: query } }),
    enabled: open && query.length >= 2,
    staleTime: 5 * 60 * 1000,
    // Keep showing the last list while the next one loads, so it doesn't flicker
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Back from the map picker with a spot
  useEffect(() => {
    if (!picked || !awaitingPick.current) return;
    awaitingPick.current = false;
    onPinChange({ latitude: picked.latitude, longitude: picked.longitude, address: picked.address });
    // Fill the name in too when the user hadn't typed one
    const name = picked.name ?? picked.address?.split(',')[0] ?? null;
    if (!value.trim() && name) onChangeText(name);
    setPickedLocation(null);
  }, [picked, value, onChangeText, onPinChange]);

  const choose = (suggestion: Suggestion) => {
    setOpen(false);
    onChangeText(suggestion.name);
    if (suggestion.latitude != null && suggestion.longitude != null) {
      onPinChange({ latitude: suggestion.latitude, longitude: suggestion.longitude, address: suggestion.address ?? null });
    }
  };

  const openPicker = () => {
    setOpen(false);
    awaitingPick.current = true;
    setPickedLocation(null);
    router.push({
      pathname: '/trips/[tripId]/pick-activity-location',
      params: {
        tripId: String(tripId),
        query: value.trim(),
        title: title?.trim() || value.trim(),
        latitude: pin ? String(pin.latitude) : '',
        longitude: pin ? String(pin.longitude) : '',
      },
    });
  };

  const list = open && query.length >= 2 ? (suggestions.data ?? []) : [];

  return (
    <View style={styles.container}>
      <TextField
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={(text) => {
          setOpen(true);
          onChangeText(text);
        }}
        onBlur={onBlur}
        onSubmitEditing={() => setOpen(false)}
        returnKeyType="done"
        autoCorrect={false}
        error={error}
      />

      {open && query.length >= 2 && (list.length > 0 || suggestions.isFetching) ? (
        <View style={styles.suggestions} accessibilityRole="list">
          {list.map((suggestion, index) => (
            <Pressable
              key={`${suggestion.latitude},${suggestion.longitude},${index}`}
              accessibilityRole="button"
              accessibilityLabel={[suggestion.name, suggestion.address].filter(Boolean).join(', ')}
              onPress={() => choose(suggestion)}
              style={({ pressed }) => [styles.suggestion, index > 0 && styles.suggestionDivider, pressed && styles.pressed]}>
              <Feather name="map-pin" size={16} color={colors.accent} style={styles.suggestionIcon} />
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {suggestion.name}
                </Text>
                {suggestion.address ? (
                  <Text style={styles.suggestionAddress} numberOfLines={1}>
                    {suggestion.address}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {suggestions.isFetching && list.length === 0 ? (
            <ActivityIndicator color={colors.accent} style={styles.suggestionsLoading} />
          ) : null}
          <Text style={styles.credit}>Suggestions © OpenStreetMap contributors</Text>
        </View>
      ) : null}

      {pin ? (
        <View style={styles.mapBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change the pin on the map"
            onPress={openPicker}
            style={({ pressed }) => pressed && styles.pressed}>
            <MiniMap latitude={pin.latitude} longitude={pin.longitude} height={140} />
            <View style={styles.mapBadge}>
              <Feather name="move" size={13} color={colors.ink} />
              <Text style={styles.mapBadgeText}>Tap to move the pin</Text>
            </View>
          </Pressable>
          <View style={styles.pinRow}>
            <Text style={styles.pinAddress} numberOfLines={2}>
              {pin.address ?? `Pinned at ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => onPinChange(null)} style={styles.removePin}>
              <Text style={styles.removePinLabel}>Remove pin</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens a map to drop a pin"
          onPress={openPicker}
          style={({ pressed }) => [styles.mapEmpty, pressed && styles.pressed]}>
          <Feather name="map" size={22} color={colors.accent} />
          <View style={styles.suggestionText}>
            <Text style={styles.mapEmptyTitle}>Choose on the map</Text>
            <Text style={styles.suggestionAddress}>Pick a suggestion above, or drop a pin yourself</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.sm,
  },
  suggestions: {
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  suggestionIcon: {
    width: 16,
  },
  suggestionText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  suggestionName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  suggestionAddress: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  suggestionsLoading: {
    paddingVertical: spacing.md,
  },
  credit: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.bg,
  },
  mapBlock: {
    gap: spacing.sm,
  },
  mapBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  mapBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    color: colors.ink,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pinAddress: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  removePin: {
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  removePinLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.dangerText,
  },
  mapEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.accentSoft,
  },
  mapEmptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accentStrong,
  },
  pressed: {
    opacity: 0.75,
  },
}));
