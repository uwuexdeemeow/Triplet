import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, useItinerary, useTrip, type ItineraryActivity } from '@/api/trips';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Body, Muted, Title } from '@/components/text';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { activityClock, dayOfMonth, eachDay, formatLongDate, todayString, weekdayShort } from '@/utils/dates';
import { formatMoney } from '@/utils/money';

export default function PlanScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const itinerary = useItinerary(id);

  // React Compiler memoizes this, so no useMemo needed
  const days = trip.data?.start_date && trip.data.end_date ? eachDay(trip.data.start_date, trip.data.end_date) : [];

  // Open on today during the trip, otherwise on the first day
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const today = todayString();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : days.includes(today) ? today : days[0];

  const plannedDays = new Set(itinerary.data?.days.map((day) => day.date));
  const day = itinerary.data?.days.find((item) => item.date === selectedDay);
  const activities = day?.activities ?? [];
  const titles = new Map(activities.map((activity) => [activity.id, activity.title]));
  const currency = trip.data?.currency ?? 'USD';

  if (!trip.data || !selectedDay) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        style={styles.daysScroller}>
        {days.map((date) => {
          const selected = date === selectedDay;
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${formatLongDate(date)}${plannedDays.has(date) ? ', has plans' : ''}`}
              onPress={() => setPickedDay(date)}
              style={[styles.dayChip, selected && styles.dayChipSelected]}>
              <Text style={[styles.dayName, selected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
              <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{dayOfMonth(date)}</Text>
              {plannedDays.has(date) ? <View style={[styles.dot, selected && styles.dotSelected]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={itinerary.isRefetching} onRefresh={itinerary.refetch} tintColor={colors.teal} />
        }>
        <View style={styles.dayHeader}>
          <Title>{formatLongDate(selectedDay)}</Title>
          {day && day.estimated_cost > 0 ? (
            <Text style={styles.dayCost}>About {formatMoney(day.estimated_cost, currency)}</Text>
          ) : null}
        </View>

        {itinerary.isPending ? (
          <ActivityIndicator color={colors.teal} style={styles.loading} />
        ) : itinerary.isError ? (
          <View style={styles.state}>
            <FormMessage message={itinerary.error.message} />
            <Button label="Try again" variant="secondary" onPress={() => itinerary.refetch()} />
          </View>
        ) : activities.length === 0 ? (
          <View style={styles.empty}>
            <Body style={styles.emptyText}>Nothing planned for this day yet.</Body>
          </View>
        ) : (
          <>
            {activities.map((activity) => (
              <ActivityRow key={activity.id} tripId={id} activity={activity} titles={titles} currency={currency} />
            ))}
            {Platform.OS === 'web' ? null : <Muted style={styles.hint}>Swipe a plan right to delete it.</Muted>}
          </>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add activity"
        onPress={() =>
          router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, day: selectedDay } })
        }
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Feather name="plus" size={26} color={colors.white} />
      </Pressable>
    </View>
  );
}

function ActivityRow({
  tripId,
  activity,
  titles,
  currency,
}: {
  tripId: number;
  activity: ItineraryActivity;
  titles: Map<number, string>;
  currency: string;
}) {
  const queryClient = useQueryClient();
  // A place planned as this activity goes back to "saved" in the Saved and Map tabs
  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/activities/${activity.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(tripId) });
      queryClient.invalidateQueries({ queryKey: tripKeys.places(tripId) });
    },
  });

  const conflicts = activity.conflicts_with ?? [];
  const details = [
    `Until ${activityClock(activity.end_time)}`,
    activity.location,
    activity.estimated_cost != null ? (activity.estimated_cost === 0 ? 'Free' : formatMoney(activity.estimated_cost, currency)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.row}>
      <Text style={styles.time}>{activityClock(activity.start_time)}</Text>
      <View style={styles.swipe}>
        <SwipeToDelete label={`Delete ${activity.title}`} radius={16} onDelete={() => remove.mutateAsync()}>
          <View style={[styles.card, conflicts.length > 0 && styles.cardConflict]}>
            <Text style={styles.cardTitle}>{activity.title}</Text>
            <Text style={styles.cardDetails} numberOfLines={2}>
              {details}
            </Text>
            {activity.source_link_id != null || conflicts.length > 0 ? (
              <View style={styles.badges}>
                {activity.source_link_id != null ? (
                  <View style={styles.badge}>
                    <Feather name="link" size={12} color={colors.muted} />
                    <Text style={styles.badgeText}>From TikTok</Text>
                  </View>
                ) : null}
                {conflicts.map((otherId) => (
                  <View key={otherId} style={[styles.badge, styles.badgeConflict]}>
                    <Feather name="alert-triangle" size={12} color={colors.coralText} />
                    <Text style={[styles.badgeText, styles.badgeConflictText]}>Overlaps {titles.get(otherId) ?? 'another plan'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {remove.error ? <Text style={styles.deleteError}>{remove.error.message}</Text> : null}
          </View>
        </SwipeToDelete>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Line the day chips and the add button up with the header on wide (web) screens
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  daysScroller: {
    flexGrow: 0,
  },
  days: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: 14,
    gap: spacing.sm,
  },
  dayChip: {
    width: 58,
    height: 68,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayChipSelected: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.tealSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.white,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  dotSelected: {
    backgroundColor: colors.white,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 110,
    gap: spacing.md,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  dayCost: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
  },
  empty: {
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.muted,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  time: {
    width: 48,
    paddingTop: 14,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  swipe: {
    flex: 1,
  },
  deleteError: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.coralText,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    gap: 3,
  },
  cardConflict: {
    borderWidth: 1.5,
    borderColor: colors.coral,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  cardDetails: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.muted,
  },
  badgeConflict: {
    backgroundColor: colors.coralSoft,
  },
  badgeConflictText: {
    color: colors.coralText,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPressed: {
    opacity: 0.85,
  },
});
