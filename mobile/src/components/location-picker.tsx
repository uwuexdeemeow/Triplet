import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError, type Schemas } from '@/api/client';
import { Button } from '@/components/button';
import { PickerMap, type Coordinates, type PickerMapHandle } from '@/components/place-map';
import { FormMessage } from '@/components/screen';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, spacing, touchTarget } from '@/theme/tokens';

type SearchResult = Schemas['PlaceSearchResult'];

export type PickedLocation = Coordinates & {
  // Only set when the pin came from a search result, whose address matches the spot
  name: string | null;
  address: string | null;
  googlePlaceId: string | null;
};

// About 150 m: dragging further than this means the pin no longer marks the chosen result
const MOVED_THRESHOLD = 0.0015;

function searchPlaces(tripId: number, text: string) {
  return api<SearchResult[]>(`/trips/${tripId}/places/search`, { query: { q: text } });
}

type Start = { center: Coordinates; zoomedOut: boolean };

function searchError(error: unknown): string {
  if (error instanceof ApiError && (error.status === 429 || error.status === 503)) return error.message;
  return 'Search isn’t working right now. You can still drag the map to place the pin.';
}

type LocationPickerProps = {
  tripId: number;
  // Shown in the bottom sheet, e.g. the place or activity name
  title: string;
  initialPin: Coordinates | null;
  // Searched to open the map in the right area when there's no pin yet
  initialQuery: string;
  // The trip's destination, the fallback area to open the map on
  destination: string | undefined;
  saving?: boolean;
  error?: string | null;
  onConfirm: (location: PickedLocation) => void;
};

/** Full-screen map with a fixed centre pin: drag or tap the map, or search, to choose a spot. */
export function LocationPicker({
  tripId,
  title,
  initialPin,
  initialQuery,
  destination,
  saving = false,
  error = null,
  onConfirm,
}: LocationPickerProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const mapRef = useRef<PickerMapHandle>(null);
  const [searchedStart, setSearchedStart] = useState<Start | null>(null);
  const [movedTo, setMovedTo] = useState<Coordinates | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [chosen, setChosen] = useState<SearchResult | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Open the map on the existing pin when there is one
  const pinStart: Start | null = initialPin ? { center: initialPin, zoomedOut: false } : null;
  const start = pinStart ?? searchedStart;
  const center = movedTo ?? start?.center ?? null;
  const hasPin = pinStart !== null;
  const firstQuery = initialQuery.trim();

  // Without a pin, search for the name, then the trip's destination, to know where to open the map
  useEffect(() => {
    if (hasPin || destination === undefined) return;

    let cancelled = false;
    (async () => {
      let found: SearchResult[] = [];
      let message: string | null = null;
      if (firstQuery.length >= 2) {
        try {
          found = await searchPlaces(tripId, firstQuery);
        } catch (err) {
          message = searchError(err);
        }
      }

      const first = found.find((result) => result.latitude != null && result.longitude != null);
      let next: Start;
      if (first) {
        next = { center: { latitude: first.latitude!, longitude: first.longitude! }, zoomedOut: false };
      } else {
        let area: SearchResult | undefined;
        try {
          area = destination ? (await searchPlaces(tripId, destination)).find((result) => result.latitude != null) : undefined;
        } catch {
          area = undefined;
        }
        if (firstQuery.length >= 2) message ??= `No results for “${firstQuery}”. Search another name, or drag the map.`;
        next = {
          center: area ? { latitude: area.latitude!, longitude: area.longitude! } : { latitude: 20, longitude: 0 },
          zoomedOut: true,
        };
      }

      if (cancelled) return;
      setResults(found);
      setSearchMessage(message);
      setSearchedStart(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPin, firstQuery, destination, tripId]);

  // The search box starts with the name until the user types
  const queryText = query ?? firstQuery;

  const runSearch = async () => {
    const text = queryText.trim();
    if (text.length < 2) return;
    setSearching(true);
    setSearchMessage(null);
    try {
      const found = await searchPlaces(tripId, text);
      setResults(found);
      if (!found.length) setSearchMessage(`No results for “${text}”.`);
    } catch (err) {
      setSearchMessage(searchError(err));
    } finally {
      setSearching(false);
    }
  };

  const choose = (result: SearchResult) => {
    if (result.latitude == null || result.longitude == null) return;
    const coordinates = { latitude: result.latitude, longitude: result.longitude };
    setChosen(result);
    setResults([]);
    setMovedTo(coordinates);
    mapRef.current?.moveTo(coordinates);
  };

  const onCenterChange = (next: Coordinates) => {
    setMovedTo(next);
    // Moved away from the chosen result: keep the pin, but its address no longer applies
    if (
      chosen &&
      (Math.abs(next.latitude - (chosen.latitude ?? 0)) > MOVED_THRESHOLD ||
        Math.abs(next.longitude - (chosen.longitude ?? 0)) > MOVED_THRESHOLD)
    ) {
      setChosen(null);
    }
  };

  const confirm = () => {
    if (!center) return;
    onConfirm({
      latitude: center.latitude,
      longitude: center.longitude,
      name: chosen?.name ?? null,
      address: chosen?.address ?? null,
      googlePlaceId: chosen?.google_place_id ?? null,
    });
  };

  const fromOsm = results.length > 0 && results.every((result) => !result.google_place_id);
  const pinLabel = chosen?.address ?? (center ? `Dropped pin · ${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}` : '');

  return (
    <View style={styles.screen}>
      {start ? (
        <PickerMap ref={mapRef} initial={start.center} zoomedOut={start.zoomedOut} onCenterChange={onCenterChange} />
      ) : (
        <View style={styles.loadingMap}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Finding {firstQuery || 'the area'} on the map…</Text>
        </View>
      )}

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.top} pointerEvents="box-none">
        <View style={styles.searchRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
            <Feather name="chevron-left" size={22} color={colors.ink} />
          </Pressable>
          <TextInput
            accessibilityLabel="Search for a place"
            placeholder="Search for a place"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            value={queryText}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            style={styles.searchInput}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={runSearch} style={styles.iconButton}>
            {searching ? <ActivityIndicator color={colors.accent} /> : <Feather name="search" size={20} color={colors.ink} />}
          </Pressable>
        </View>

        {results.length > 0 ? (
          <View style={styles.results}>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.resultsScroll}>
              {results.map((result, index) => (
                <Pressable
                  key={`${result.latitude},${result.longitude},${index}`}
                  accessibilityRole="button"
                  onPress={() => choose(result)}
                  style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {result.name}
                  </Text>
                  {result.address ? (
                    <Text style={styles.resultAddress} numberOfLines={2}>
                      {result.address}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            {fromOsm ? <Text style={styles.credit}>Search © OpenStreetMap contributors</Text> : null}
          </View>
        ) : null}

        {searchMessage ? (
          <View style={styles.messageWrap}>
            <FormMessage message={searchMessage} />
          </View>
        ) : null}
      </SafeAreaView>

      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bottom}>
        <Text style={styles.hint}>Drag or tap the map to move the pin</Text>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.pinLabel} numberOfLines={2}>
          {pinLabel}
        </Text>
        <FormMessage message={error} />
        <Button label="Use this location" loading={saving} disabled={!center} onPress={confirm} />
      </SafeAreaView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.chip,
  },
  loadingMap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  results: {
    marginLeft: 56,
    marginRight: 56,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  resultsScroll: {
    maxHeight: 280,
  },
  result: {
    minHeight: touchTarget + 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.chip,
  },
  resultPressed: {
    backgroundColor: colors.accentSoft,
  },
  resultName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  resultAddress: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  credit: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  messageWrap: {
    marginHorizontal: 56,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: spacing.lg,
    gap: 6,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  hint: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  title: {
    fontFamily: fonts.displaySemi,
    letterSpacing: headingTracking,
    fontSize: 22,
    color: colors.ink,
  },
  pinLabel: {
    marginBottom: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
}));
