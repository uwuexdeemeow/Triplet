import { useState } from 'react';
import { Text, View } from 'react-native';

import { usePlaces, type ItineraryActivity, type StayStop } from '@/api/trips';
import { TripMap, type MapPlace } from '@/components/place-map';
import { makeStyles } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  tripId: number;
  // The selected day's plans; the ones with a pin are drawn
  activities: ItineraryActivity[];
  // The hotels the day starts and ends at, so the route runs from one to the other
  startStay?: StayStop | null;
  endStay?: StayStop | null;
};

function stayPin(stay: StayStop | null | undefined, id: string): MapPlace | null {
  if (!stay || stay.latitude == null || stay.longitude == null) return null;
  return { id, name: stay.name, latitude: stay.latitude, longitude: stay.longitude, planned: true, label: 'H' };
}

/**
 * The trip workspace's map on a big screen: the day's plans, plus saved places that aren't
 * planned yet, so you can see what's nearby while arranging the day.
 */
export function PlanMapPanel({ tripId, activities, startStay, endStay }: Props) {
  const styles = useStyles();
  const places = usePlaces(tripId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Numbered by position in the day, so the pins match the plan list even when a plan has no pin
  const planned: MapPlace[] = activities
    .map((activity, index) => ({ activity, label: String(index + 1) }))
    .filter(({ activity }) => activity.latitude != null && activity.longitude != null)
    .map(({ activity, label }) => ({
      id: `activity-${activity.id}`,
      name: activity.title,
      latitude: activity.latitude!,
      longitude: activity.longitude!,
      planned: true,
      label,
    }));
  const saved: MapPlace[] = (places.data ?? [])
    .filter((place) => place.activity_ids.length === 0 && place.latitude != null && place.longitude != null)
    .map((place) => ({
      id: `place-${place.id}`,
      name: place.name,
      latitude: place.latitude!,
      longitude: place.longitude!,
      planned: false,
    }));
  const start = stayPin(startStay, `stay-${startStay?.id}`);
  // The same hotel morning and night is one pin; a different one gets its own
  const end = endStay && endStay.id !== startStay?.id ? stayPin(endStay, `stay-${endStay.id}`) : null;
  const backTo = endStay && endStay.id === startStay?.id ? start : end;
  const hotels = [start, end].filter((pin): pin is MapPlace => pin != null);
  const route = [...(start ? [start] : []), ...planned, ...(backTo ? [backTo] : [])];
  const pins = [...hotels, ...planned, ...saved];
  const selected = pins.find((pin) => pin.id === selectedId);

  return (
    <View style={styles.panel}>
      {/* Room at the bottom so no stop hides under the legend */}
      <TripMap places={pins} selectedId={selectedId} onSelect={setSelectedId} route={route} bottomInset={60} />
      <View style={styles.legend} pointerEvents="none">
        {selected ? (
          <Text style={styles.selected} numberOfLines={1}>
            {selected.name}
            {selected.id.startsWith('stay-') ? ' · where you stay' : selected.planned ? '' : ' · saved, not planned yet'}
          </Text>
        ) : (
          <>
            <Text style={styles.legendText}>
              {planned.length} {planned.length === 1 ? 'plan' : 'plans'} on the map this day
            </Text>
            {saved.length > 0 ? (
              <Text style={styles.legendMuted}>
                {saved.length} saved {saved.length === 1 ? 'place' : 'places'} not planned yet
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
    overflow: 'hidden',
  },
  legend: {
    position: 'absolute',
    left: spacing.lg,
    bottom: spacing.lg,
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    gap: 4,
    borderRadius: radii.card,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.glassEdge,
  },
  legendText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.ink,
  },
  legendMuted: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.muted,
  },
  selected: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.ink,
  },
}));
