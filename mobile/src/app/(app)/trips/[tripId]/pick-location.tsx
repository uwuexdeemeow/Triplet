import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError, type Schemas } from '@/api/client';
import { tripKeys, usePlaces, useTrip } from '@/api/trips';
import { Button } from '@/components/button';
import { PickerMap, type Coordinates, type PickerMapHandle } from '@/components/place-map';
import { FormMessage } from '@/components/screen';
import { colors, fonts, spacing, touchTarget } from '@/theme/tokens';

type SearchResult = Schemas['PlaceSearchResult'];

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

export default function PickLocationScreen() {
  const { tripId, placeId } = useLocalSearchParams<{ tripId: string; placeId: string }>();
  const id = Number(tripId);
  const queryClient = useQueryClient();
  const trip = useTrip(id);
  const places = usePlaces(id);
  const place = places.data?.find((item) => item.id === Number(placeId));

  const mapRef = useRef<PickerMapHandle>(null);
  const [searchedStart, setSearchedStart] = useState<Start | null>(null);
  const [movedTo, setMovedTo] = useState<Coordinates | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [chosen, setChosen] = useState<SearchResult | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Open the map on the existing pin when there is one
  const pinStart: Start | null =
    place?.latitude != null && place.longitude != null
      ? { center: { latitude: place.latitude, longitude: place.longitude }, zoomedOut: false }
      : null;
  const start = pinStart ?? searchedStart;
  const center = movedTo ?? start?.center ?? null;
  const placeName = place?.name;
  const destination = trip.data?.destination;
  const hasPin = pinStart !== null;

  // Without a pin, search for the place's name, then the trip's destination, to know where to open the map
  useEffect(() => {
    if (hasPin || !placeName || !destination) return;

    let cancelled = false;
    (async () => {
      let found: SearchResult[] = [];
      let message: string | null = null;
      try {
        found = await searchPlaces(id, placeName);
      } catch (error) {
        message = searchError(error);
      }

      const first = found.find((result) => result.latitude != null && result.longitude != null);
      let start: Start;
      if (first) {
        start = { center: { latitude: first.latitude!, longitude: first.longitude! }, zoomedOut: false };
      } else {
        let area: SearchResult | undefined;
        try {
          area = (await searchPlaces(id, destination)).find((result) => result.latitude != null);
        } catch {
          area = undefined;
        }
        message ??= `No results for “${placeName}”. Search another name, or drag the map.`;
        start = {
          center: area ? { latitude: area.latitude!, longitude: area.longitude! } : { latitude: 20, longitude: 0 },
          zoomedOut: true,
        };
      }

      if (cancelled) return;
      setResults(found);
      setSearchMessage(message);
      setSearchedStart(start);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPin, placeName, destination, id]);

  // The search box starts with the place's name until the user types
  const queryText = query ?? placeName ?? '';

  const runSearch = async () => {
    const text = queryText.trim();
    if (text.length < 2) return;
    setSearching(true);
    setSearchMessage(null);
    try {
      const found = await searchPlaces(id, text);
      setResults(found);
      if (!found.length) setSearchMessage(`No results for “${text}”.`);
    } catch (error) {
      setSearchMessage(searchError(error));
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
    // Dragged away from the chosen result: keep the pin, but its address no longer applies
    if (
      chosen &&
      (Math.abs(next.latitude - (chosen.latitude ?? 0)) > MOVED_THRESHOLD ||
        Math.abs(next.longitude - (chosen.longitude ?? 0)) > MOVED_THRESHOLD)
    ) {
      setChosen(null);
    }
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/trips/${id}/places/${placeId}`, {
        method: 'PATCH',
        body: {
          latitude: center!.latitude,
          longitude: center!.longitude,
          // Only a search result comes with a trustworthy address for the new spot
          ...(chosen?.address ? { address: chosen.address } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.links(id) });
      router.back();
    },
  });

  const fromOsm = results.length > 0 && results.every((result) => !result.google_place_id);
  const pinLabel = chosen?.address ?? (center ? `Dropped pin · ${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}` : '');

  return (
    <View style={styles.screen}>
      {start ? (
        <PickerMap ref={mapRef} initial={start.center} zoomedOut={start.zoomedOut} onCenterChange={onCenterChange} />
      ) : (
        <View style={styles.loadingMap}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.loadingText}>Finding {place?.name ?? 'the place'} on the map…</Text>
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
            {searching ? <ActivityIndicator color={colors.teal} /> : <Feather name="search" size={20} color={colors.ink} />}
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
        <Text style={styles.hint}>Drag the map to move the pin</Text>
        <Text style={styles.placeName}>{place?.name}</Text>
        <Text style={styles.pinLabel} numberOfLines={2}>
          {pinLabel}
        </Text>
        <FormMessage message={save.error?.message ?? null} />
        <Button label="Use this location" loading={save.isPending} disabled={!center} onPress={() => save.mutate()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  results: {
    marginLeft: 56,
    marginRight: 56,
    borderRadius: 14,
    backgroundColor: colors.card,
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
    backgroundColor: colors.tealSoft,
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
    backgroundColor: colors.paper,
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
  placeName: {
    fontFamily: fonts.displaySemi,
    fontSize: 22,
    color: colors.ink,
  },
  pinLabel: {
    marginBottom: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
});
