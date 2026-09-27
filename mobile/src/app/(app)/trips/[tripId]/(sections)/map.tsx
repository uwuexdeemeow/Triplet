import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Schemas } from '@/api/client';
import {
  useItinerary,
  useMe,
  useMembers,
  usePlaces,
  useTrip,
  type ItineraryActivity,
  type TripPlace,
} from '@/api/trips';
import { Button } from '@/components/button';
import { MapSearch } from '@/components/map-search';
import { TripMap, type Coordinates, type MapPlace, type TripMapHandle } from '@/components/place-map';
import { Glass } from '@/components/glass';
import { FormMessage } from '@/components/screen';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { activityClock, formatShortDate } from '@/utils/dates';
import { needsCheck, placeDetail } from '@/utils/places';
import { select as selectionTick } from '@/utils/haptics';

type SearchResult = Schemas['PlaceSearchResult'];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'planned', label: 'In the plan' },
  { key: 'saved', label: 'Saved only' },
] as const;

type Filter = (typeof FILTERS)[number]['key'];

// A spot to add something at: long-pressed on the map, or picked from search (which already knows its name)
type Dropped = Coordinates & { known?: { name: string; address: string | null } };

// A pin is either a plan (any activity with a location) or a saved place that isn't planned yet
type MapItem =
  | (MapPlace & { kind: 'activity'; activity: ItineraryActivity; day: string })
  | (MapPlace & { kind: 'place'; place: TripPlace });

function isPlanned(place: TripPlace): boolean {
  return (place.activity_ids?.length ?? 0) > 0;
}

function hasPin<T extends { latitude?: number | null; longitude?: number | null }>(
  item: T,
): item is T & { latitude: number; longitude: number } {
  return item.latitude != null && item.longitude != null;
}

export default function TripMapScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const insets = useSafeAreaInsets();
  const trip = useTrip(id);
  const places = usePlaces(id);
  const itinerary = useItinerary(id);
  const me = useMe();
  const members = useMembers(id);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<TripMapHandle>(null);

  const role = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const canEdit = role === 'owner' || role === 'member';

  // Every plan with a location, whether it came from a TikTok or was added by hand
  const activityItems: MapItem[] = (itinerary.data?.days ?? []).flatMap((day) =>
    day.activities.filter(hasPin).map((activity) => ({
      kind: 'activity' as const,
      id: `activity-${activity.id}`,
      name: activity.title,
      latitude: activity.latitude,
      longitude: activity.longitude,
      planned: true,
      activity,
      day: day.date,
    })),
  );
  const pinnedActivityIds = new Set(activityItems.map((item) => (item.kind === 'activity' ? item.activity.id : 0)));

  // Saved places, unless one of their plans is already on the map
  const placeItems: MapItem[] = (places.data ?? [])
    .filter(hasPin)
    .filter((place) => !place.activity_ids?.some((activityId) => pinnedActivityIds.has(activityId)))
    .map((place) => ({
      kind: 'place' as const,
      id: `place-${place.id}`,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      planned: isPlanned(place),
      place,
    }));

  const items = [...activityItems, ...placeItems];
  const unpinned = (places.data ?? []).filter((place) => !hasPin(place) && !isPlanned(place) && place.details_status !== 'pending');
  const lookingUp = (places.data ?? []).some((place) => !hasPin(place) && place.details_status === 'pending');

  const counts: Record<Filter, number> = {
    all: items.length,
    planned: items.filter((item) => item.planned).length,
    saved: items.filter((item) => !item.planned).length,
  };
  const shown = items.filter((item) => filter === 'all' || (filter === 'planned') === item.planned);
  const selected = shown.find((item) => item.id === selectedId) ?? null;

  // With nothing pinned, open the map on the trip's destination
  const destination = trip.data?.destination;
  const area = useQuery({
    queryKey: ['trips', id, 'suggest', destination ?? ''],
    queryFn: () => api<SearchResult[]>(`/trips/${id}/places/suggest`, { query: { q: destination ?? '' } }),
    enabled: !!destination && destination.length >= 2 && !places.isPending && !itinerary.isPending && items.length === 0,
    staleTime: Infinity,
    retry: false,
  });
  const areaResult = area.data?.find(hasPin);
  const fallbackCenter = areaResult ? { latitude: areaResult.latitude!, longitude: areaResult.longitude! } : null;

  if (places.isPending || itinerary.isPending) return <ActivityIndicator color={colors.accent} style={styles.loading} />;

  if (places.isError || itinerary.isError) {
    return (
      <View style={styles.state}>
        <FormMessage message={(places.error ?? itinerary.error)?.message ?? null} />
        <Button
          label="Try again"
          variant="secondary"
          onPress={() => {
            places.refetch();
            itinerary.refetch();
          }}
        />
      </View>
    );
  }

  const select = (itemId: string | null) => {
    setSelectedId(itemId);
    setDropped(null);
  };

  return (
    <View style={styles.screen}>
      <TripMap
        ref={mapRef}
        places={shown}
        selectedId={selected?.id ?? null}
        onSelect={select}
        fallbackCenter={fallbackCenter}
        droppedPin={dropped}
        onLongPress={
          canEdit
            ? (coordinates) => {
                setSelectedId(null);
                setDropped(coordinates);
              }
            : undefined
        }
        bottomInset={sheetHeight}
      />

      <View style={styles.top} pointerEvents="box-none">
        <View style={styles.searchWrap}>
          <MapSearch
            tripId={id}
            onOpenChange={setSearching}
            onPick={(result) => {
              setSelectedId(null);
              setDropped({
                latitude: result.latitude,
                longitude: result.longitude,
                known: { name: result.name, address: result.address ?? null },
              });
              mapRef.current?.moveTo(result);
            }}
          />
        </View>
        {searching ? null : (
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
                    selectionTick();
                    setFilter(key);
                    select(null);
                  }}
                  style={styles.filterPress}>
                  <Glass interactive tintColor={active ? colors.accent : undefined} style={styles.filter}>
                    {key !== 'all' ? (
                      <View style={[styles.dot, { backgroundColor: key === 'planned' ? colors.accent : colors.second }]} />
                    ) : null}
                    <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                      {label} · {counts[key]}
                    </Text>
                  </Glass>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Glass
        // Floats over the map, clear of the screen's edges and home indicator
        style={[styles.sheet, { bottom: Math.max(insets.bottom, spacing.md) }]}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        {dropped ? (
          <DroppedPin tripId={tripId} dropped={dropped} canEdit={canEdit} onCancel={() => setDropped(null)} />
        ) : selected?.kind === 'activity' ? (
          <SelectedActivity tripId={tripId} activity={selected.activity} day={selected.day} canEdit={canEdit} />
        ) : selected?.kind === 'place' ? (
          <SelectedPlace tripId={tripId} place={selected.place} />
        ) : (
          <Idle
            tripId={tripId}
            canEdit={canEdit}
            unpinned={unpinned}
            note={
              lookingUp
                ? 'Looking up addresses… pins appear as they’re found.'
                : items.length === 0
                  ? 'Nothing on the map yet.'
                  : shown.length === 0
                    ? filter === 'planned'
                      ? 'No plans with a location yet.'
                      : 'Every saved place is already in the plan.'
                    : null
            }
          />
        )}
      </Glass>
    </View>
  );
}

// Nothing selected: how to use the map, and a way to add a plan
function Idle({
  tripId,
  canEdit,
  unpinned,
  note,
}: {
  tripId: string;
  canEdit: boolean;
  unpinned: TripPlace[];
  note: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const how = Platform.OS === 'web' ? 'Right-click' : 'Long-press';

  return (
    <View style={styles.idle}>
      <View style={styles.idleRow}>
        <View style={styles.idleText}>
          {note ? <Text style={styles.idleNote}>{note}</Text> : null}
          <Text style={styles.idleHint}>
            Tap a pin to see it.{canEdit ? ` ${how} the map to add a plan there.` : ''}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add activity"
            onPress={() => router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId } })}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <Feather name="plus" size={18} color={colors.onAccent} />
            <Text style={styles.addLabel}>Add</Text>
          </Pressable>
        ) : null}
      </View>

      {unpinned.length > 0 ? (
        <View style={styles.unpinned}>
          <Text style={styles.sheetTitle}>
            {unpinned.length} saved {unpinned.length === 1 ? 'place needs' : 'places need'} a pin
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unpinnedList}>
            {unpinned.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Drop a pin for ${place.name}`}
                onPress={() =>
                  router.push({ pathname: '/trips/[tripId]/pick-location', params: { tripId, placeId: String(place.id) } })
                }
                style={({ pressed }) => [styles.unpinnedChip, pressed && styles.pressed]}>
                <Feather name="map-pin" size={14} color={colors.secondText} />
                <Text style={styles.unpinnedLabel} numberOfLines={1}>
                  {place.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

// A pin the user dropped: say what's there and offer to plan something
function DroppedPin({
  tripId,
  dropped: coordinates,
  canEdit,
  onCancel,
}: {
  tripId: string;
  dropped: Dropped;
  canEdit: boolean;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const known = coordinates.known;
  const lookup = useQuery({
    // Rounded, so a tiny nudge of the same spot reuses the answer
    queryKey: ['trips', Number(tripId), 'reverse', coordinates.latitude.toFixed(4), coordinates.longitude.toFixed(4)],
    queryFn: () =>
      api<SearchResult | null>(`/trips/${tripId}/places/reverse`, {
        query: { lat: coordinates.latitude, lon: coordinates.longitude },
      }),
    staleTime: Infinity,
    retry: false,
    // A search result already says what's there
    enabled: !known,
  });

  const found = known ?? lookup.data ?? null;
  const addHere = () => {
    onCancel();
    router.push({
      pathname: '/trips/[tripId]/add-activity',
      params: {
        tripId,
        latitude: String(coordinates.latitude),
        longitude: String(coordinates.longitude),
        location: found?.name ?? '',
        address: found?.address ?? '',
      },
    });
  };

  return (
    <View style={styles.selected}>
      <View style={styles.selectedText}>
        <Text style={styles.kicker}>{known ? 'Search result' : 'Dropped pin'}</Text>
        {!known && lookup.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.lookupLoading} />
        ) : (
          <>
            <Text style={styles.selectedName} numberOfLines={2}>
              {found?.name ?? 'This spot'}
            </Text>
            <Text style={styles.address} numberOfLines={2}>
              {found?.address ?? `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`}
            </Text>
          </>
        )}
      </View>
      {canEdit ? (
        <View style={styles.actions}>
          <Button label="Cancel" variant="secondary" style={styles.action} onPress={onCancel} />
          <Button label="Add activity here" style={styles.actionWide} onPress={addHere} />
        </View>
      ) : (
        <Button label="Close" variant="secondary" onPress={onCancel} />
      )}
    </View>
  );
}

function SelectedActivity({
  tripId,
  activity,
  day,
  canEdit,
}: {
  tripId: string;
  activity: ItineraryActivity;
  day: string;
  canEdit: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.selected}>
      <View style={styles.selectedText}>
        <Text style={styles.kicker}>In the plan</Text>
        <Text style={styles.selectedName} numberOfLines={2}>
          {activity.title}
        </Text>
        <Text style={[styles.detail, styles.detailAccent]}>
          {formatShortDate(day)} · {activityClock(activity.start_time)}–{activityClock(activity.end_time)}
        </Text>
        {activity.location ? (
          <Text style={styles.address} numberOfLines={1}>
            {activity.location}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label="See it in the plan"
          variant="secondary"
          style={styles.actionWide}
          onPress={() => router.replace({ pathname: '/trips/[tripId]', params: { tripId, day } })}
        />
        {canEdit ? (
          <Button
            label="Edit"
            style={styles.action}
            onPress={() =>
              router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, activityId: String(activity.id) } })
            }
          />
        ) : null}
      </View>
    </View>
  );
}

function SelectedPlace({ tripId, place }: { tripId: string; place: TripPlace }) {
  const styles = useStyles();
  const detail = placeDetail(place, undefined);
  const params = { tripId, placeId: String(place.id) };
  const planned = isPlanned(place);

  return (
    <View style={styles.selected}>
      <View style={styles.selectedText}>
        <Text style={styles.kicker}>{planned ? 'In the plan' : 'Saved from a post'}</Text>
        <Text style={styles.selectedName} numberOfLines={2}>
          {place.name}
        </Text>
        {detail.text ? (
          <Text
            numberOfLines={1}
            style={[styles.detail, detail.tone === 'accent' && styles.detailAccent, detail.tone === 'attention' && styles.detailAttention]}>
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

const useStyles = makeStyles((colors) => ({
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
  top: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    gap: spacing.sm,
  },
  searchWrap: {
    paddingHorizontal: 20,
  },
  filters: {
    flexGrow: 0,
  },
  filtersContent: {
    paddingHorizontal: 20,
    gap: spacing.sm,
  },
  filterPress: {
    borderRadius: radii.pill,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  filterLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  filterLabelActive: {
    fontFamily: fonts.bold,
    color: colors.onAccent,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: spacing.lg,
    borderRadius: 28,
  },
  idle: {
    gap: spacing.md,
  },
  idleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  idleText: {
    flex: 1,
    gap: 2,
  },
  idleNote: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  idleHint: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: colors.muted,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  addLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.onAccent,
  },
  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  kicker: {
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
    letterSpacing: headingTracking,
    fontSize: 22,
    color: colors.ink,
  },
  lookupLoading: {
    alignSelf: 'flex-start',
    marginVertical: spacing.sm,
  },
  detail: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  detailAccent: {
    color: colors.accent,
  },
  detailAttention: {
    color: colors.secondText,
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
  actionWide: {
    flex: 2,
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
    backgroundColor: colors.secondSoft,
  },
  unpinnedLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.secondText,
  },
  pressed: {
    opacity: 0.75,
  },
}));
