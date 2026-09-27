import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useItinerary, usePlaces, type TripPlace } from '@/api/trips';
import { Button } from '@/components/button';
import { TripMap, type MapPlace } from '@/components/place-map';
import { FormMessage } from '@/components/screen';
import { Body, Title } from '@/components/text';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { needsCheck, placeDetail } from '@/utils/places';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'planned', label: 'In the plan' },
  { key: 'saved', label: 'Saved only' },
] as const;

type Filter = (typeof FILTERS)[number]['key'];

function isPlanned(place: TripPlace): boolean {
  return (place.activity_ids?.length ?? 0) > 0;
}

function hasPin(place: TripPlace): place is TripPlace & { latitude: number; longitude: number } {
  return place.latitude != null && place.longitude != null;
}

export default function TripMapScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const insets = useSafeAreaInsets();
  const places = usePlaces(id);
  const itinerary = useItinerary(id);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);

  if (places.isPending) return <ActivityIndicator color={colors.teal} style={styles.loading} />;

  if (places.isError) {
    return (
      <View style={styles.state}>
        <FormMessage message={places.error.message} />
        <Button label="Try again" variant="secondary" onPress={() => places.refetch()} />
      </View>
    );
  }

  if (places.data.length === 0) {
    return (
      <View style={styles.state}>
        <Feather name="map" size={32} color={colors.muted} style={styles.stateIcon} />
        <Title style={styles.center}>No places yet</Title>
        <Body style={styles.stateText}>
          Save a TikTok in the Saved tab and the places it mentions will show up here.
        </Body>
        <Button
          label="Go to Saved"
          variant="secondary"
          onPress={() => router.replace({ pathname: '/trips/[tripId]/saved', params: { tripId } })}
        />
      </View>
    );
  }

  // Which day each planned activity is on, for "In the plan · Fri 2 Oct"
  const activityDays = new Map<number, string>();
  for (const day of itinerary.data?.days ?? []) {
    for (const activity of day.activities) activityDays.set(activity.id, day.date);
  }

  const pinned = places.data.filter(hasPin);
  const unpinned = places.data.filter((place) => !hasPin(place) && place.details_status !== 'pending');
  const lookingUp = places.data.some((place) => !hasPin(place) && place.details_status === 'pending');

  const counts: Record<Filter, number> = {
    all: pinned.length,
    planned: pinned.filter(isPlanned).length,
    saved: pinned.filter((place) => !isPlanned(place)).length,
  };
  const shown = pinned.filter((place) => filter === 'all' || (filter === 'planned') === isPlanned(place));
  const mapPlaces: MapPlace[] = shown.map((place) => ({
    id: place.id,
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    planned: isPlanned(place),
  }));
  const selected = shown.find((place) => place.id === selectedId) ?? null;

  return (
    <View style={styles.screen}>
      <TripMap places={mapPlaces} selectedId={selected?.id ?? null} onSelect={setSelectedId} bottomInset={sheetHeight} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filters}
        contentContainerStyle={styles.filtersContent}>
        {FILTERS.map(({ key, label }) => {
          const active = key === filter;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                setFilter(key);
                setSelectedId(null);
              }}
              style={[styles.filter, active && styles.filterActive]}>
              {key !== 'all' ? (
                <View style={[styles.dot, { backgroundColor: key === 'planned' ? colors.teal : colors.coral }]} />
              ) : null}
              <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                {label} · {counts[key]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
        pointerEvents="box-none">
        {selected ? (
          <SelectedPlace
            tripId={tripId}
            place={selected}
            plannedDay={selected.activity_ids?.map((activityId) => activityDays.get(activityId)).find(Boolean)}
          />
        ) : unpinned.length > 0 ? (
          <Unpinned tripId={tripId} places={unpinned} />
        ) : shown.length === 0 ? (
          <Text style={styles.sheetNote}>
            {lookingUp
              ? 'Looking up addresses… pins appear as they’re found.'
              : filter === 'planned'
                ? 'Nothing from your saved places is in the plan yet.'
                : filter === 'saved'
                  ? 'Every pinned place is already in the plan.'
                  : 'No places have a pin yet.'}
          </Text>
        ) : (
          <Text style={styles.sheetNote}>
            {lookingUp ? 'Looking up more addresses… ' : ''}Tap a pin to see the place.
          </Text>
        )}
      </View>
    </View>
  );
}

function SelectedPlace({ tripId, place, plannedDay }: { tripId: string; place: TripPlace; plannedDay: string | undefined }) {
  const detail = placeDetail(place, plannedDay);
  const params = { tripId, placeId: String(place.id) };
  const planned = isPlanned(place);

  return (
    <View style={styles.selected}>
      <View style={styles.selectedText}>
        <Text style={styles.selectedName} numberOfLines={2}>
          {place.name}
        </Text>
        {detail.text ? (
          <Text
            numberOfLines={1}
            style={[
              styles.detail,
              detail.tone === 'teal' && styles.detailTeal,
              detail.tone === 'coral' && styles.detailCoral,
            ]}>
            {detail.text}
          </Text>
        ) : null}
        {place.address && detail.text !== place.address ? (
          <Text style={styles.address} numberOfLines={1}>
            {place.address}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label="Details"
          variant="secondary"
          style={styles.action}
          onPress={() => router.push({ pathname: '/trips/[tripId]/places/[placeId]', params })}
        />
        {!planned ? (
          needsCheck(place) ? (
            // Same as the Saved tab: confirm the location before planning it
            <Button
              label="Review"
              style={styles.action}
              onPress={() => router.push({ pathname: '/trips/[tripId]/places/[placeId]', params })}
            />
          ) : (
            <Button
              label="Add to plan"
              style={styles.action}
              onPress={() => router.push({ pathname: '/trips/[tripId]/add-place', params })}
            />
          )
        ) : null}
      </View>
    </View>
  );
}

function Unpinned({ tripId, places }: { tripId: string; places: TripPlace[] }) {
  return (
    <View style={styles.unpinned}>
      <Text style={styles.sheetTitle}>
        {places.length} {places.length === 1 ? 'place needs' : 'places need'} a pin
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unpinnedList}>
        {places.map((place) => (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            accessibilityLabel={`Drop a pin for ${place.name}`}
            onPress={() =>
              router.push({ pathname: '/trips/[tripId]/pick-location', params: { tripId, placeId: String(place.id) } })
            }
            style={({ pressed }) => [styles.unpinnedChip, pressed && styles.pressed]}>
            <Feather name="map-pin" size={14} color={colors.coralText} />
            <Text style={styles.unpinnedLabel} numberOfLines={1}>
              {place.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.chip,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  state: {
    padding: 20,
    paddingTop: spacing.xxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  stateIcon: {
    alignSelf: 'center',
  },
  center: {
    textAlign: 'center',
  },
  stateText: {
    textAlign: 'center',
    color: colors.muted,
  },
  filters: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    flexGrow: 0,
  },
  filtersContent: {
    paddingHorizontal: 20,
    gap: spacing.sm,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  filterActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  filterLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  filterLabelActive: {
    fontFamily: fonts.bold,
    color: colors.white,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetNote: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  selected: {
    gap: spacing.md,
  },
  selectedText: {
    gap: 3,
  },
  selectedName: {
    fontFamily: fonts.displaySemi,
    fontSize: 22,
    color: colors.ink,
  },
  detail: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  detailTeal: {
    color: colors.teal,
  },
  detailCoral: {
    color: colors.coralText,
  },
  address: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
  unpinned: {
    gap: spacing.sm,
  },
  unpinnedList: {
    gap: spacing.sm,
  },
  unpinnedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.coralSoft,
  },
  unpinnedLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.coralText,
  },
  pressed: {
    opacity: 0.75,
  },
});
