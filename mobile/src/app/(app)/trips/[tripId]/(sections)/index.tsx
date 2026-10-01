import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { api } from '@/api/client';
import {
  tripKeys,
  useBudgetEstimate,
  useExpenses,
  useItinerary,
  useMe,
  useMembers,
  useStays,
  useTrip,
  type ItineraryActivity,
} from '@/api/trips';
import { Enter } from '@/components/enter';
import { Button } from '@/components/button';
import { Fab } from '@/components/fab';
import { FormMessage } from '@/components/screen';
import {
  ActivityRow,
  AddStayPrompt,
  DayChips,
  EditHint,
  StayRow,
  stayEndpoint,
  TravelConnector,
  type ActivityActions,
} from '@/components/plan-rows';
import { Body, Title } from '@/components/text';
import { WeatherLine } from '@/components/weather-line';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { PlanMapPanel } from '@/components/plan-map-panel';
import {
  eachDay,
  formatLongDate,
  formatDateRange,
  formatShortDate,
  todayString,
} from '@/utils/dates';
import { useShowsMapPanel, useWideLayout } from '@/utils/layout';
import { usePullToRefresh } from '@/utils/pull-to-refresh';
import { formatMoney } from '@/utils/money';

export default function PlanScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  // Other tabs can open the plan on a given day, e.g. the map's "See in plan"
  const { tripId, day: dayParam } = useLocalSearchParams<{ tripId: string; day?: string }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const itinerary = useItinerary(id);
  const expenses = useExpenses(id);

  // What's been spent on each plan, from expenses linked to it in the Budget tab
  const paid = new Map<number, number>();
  for (const expense of expenses.data ?? []) {
    if (expense.activity_id != null) paid.set(expense.activity_id, (paid.get(expense.activity_id) ?? 0) + expense.amount);
  }
  const me = useMe();
  const members = useMembers(id);
  const role = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const canEdit = role === 'owner' || role === 'member';

  // React Compiler memoizes this, so no useMemo needed
  const days = trip.data?.start_date && trip.data.end_date ? eachDay(trip.data.start_date, trip.data.end_date) : [];

  // Open on today during the trip, otherwise on the first day
  const [pickedDay, setPickedDay] = useState<string | null>(dayParam ?? null);
  const today = todayString();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : days.includes(today) ? today : days[0];

  // Days that only start or end at a hotel don't count as planned
  const plannedDays = new Set(itinerary.data?.days.filter((day) => day.activities.length).map((day) => day.date));
  const day = itinerary.data?.days.find((item) => item.date === selectedDay);
  const activities = day?.activities ?? [];
  const titles = new Map(activities.map((activity) => [activity.id, activity.title]));
  const currency = trip.data?.currency ?? 'USD';
  // Directions to a place without a pin search here, the trip's first destination
  const area = trip.data?.destinations?.[0]?.name ?? trip.data?.destination ?? null;
  const wide = useWideLayout();
  const mapPanel = useShowsMapPanel();
  const pull = usePullToRefresh(itinerary.refetch);
  const queryClient = useQueryClient();

  if (!trip.data || !selectedDay) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
    // Deleting a plan unlinks its expenses, and the budget counts plan costs
    queryClient.invalidateQueries({ queryKey: tripKeys.expenses(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(id) });
  };

  const memberActions = (activity: ItineraryActivity): ActivityActions => ({
    onEdit: () =>
      router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, activityId: String(activity.id) } }),
    onRename: async (title) => {
      await api(`/trips/${id}/activities/${activity.id}`, { method: 'PATCH', body: { title } });
      refresh();
    },
    // A place planned as this activity goes back to "saved" in the Saved and Map tabs
    onDelete: async () => {
      await api(`/trips/${id}/activities/${activity.id}`, { method: 'DELETE' });
      refresh();
    },
    deleteDetail: activity.place_id != null ? 'The saved place stays in the Saved tab.' : undefined,
    // The edit form is where a plan gets its pin
    onSetLocation: () =>
      router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, activityId: String(activity.id) } }),
  });

  const openAdd = () => router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, day: selectedDay } });
  const openStay = (stayId?: number, checkIn?: string) =>
    router.push({
      pathname: '/trips/[tripId]/stay',
      params: { tripId, ...(stayId != null ? { stayId: String(stayId) } : {}), ...(checkIn ? { checkIn } : {}) },
    });

  // Where the day starts and ends: last night's hotel and tonight's
  const startStay = day?.start_stay ?? null;
  const endStay = day?.end_stay ?? null;
  const lastActivity = activities[activities.length - 1];
  const isLastDay = selectedDay === days[days.length - 1];

  // The selected day's plans, the same on a phone and in the wide layout
  const dayPlans = (
    <>
      <View style={styles.dayHeader}>
        <Title>{formatLongDate(selectedDay)}</Title>
        {day && day.estimated_cost > 0 ? (
          <Text style={styles.dayCost}>About {formatMoney(day.estimated_cost, currency)}</Text>
        ) : null}
      </View>
      {day?.weather ? <WeatherLine weather={day.weather} /> : null}

      {startStay ? (
        <StayRow stay={startStay} role="start" area={area} onPress={canEdit ? () => openStay(startStay.id) : undefined} />
      ) : null}

      {itinerary.isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
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
          {activities.map((activity, index) => (
            <Enter key={activity.id} index={index}>
              {activity.travel_from_previous ? (
                <TravelConnector
                  leg={activity.travel_from_previous}
                  // The first plan's trip is from the hotel
                  from={index > 0 ? activities[index - 1] : startStay ? stayEndpoint(startStay) : undefined}
                  to={activity}
                />
              ) : null}
              <ActivityRow
                activity={activity}
                titles={titles}
                currency={currency}
                paid={paid.get(activity.id)}
                stop={mapPanel ? index + 1 : undefined}
                actions={canEdit ? memberActions(activity) : undefined}
                area={area}
              />
            </Enter>
          ))}
        </>
      )}

      {itinerary.isSuccess && endStay ? (
        <>
          {day?.travel_to_stay && lastActivity ? (
            <TravelConnector leg={day.travel_to_stay} from={lastActivity} to={stayEndpoint(endStay)} />
          ) : null}
          <StayRow
            stay={endStay}
            role={startStay?.id === endStay.id ? 'back' : 'check-in'}
            area={area}
            onPress={canEdit ? () => openStay(endStay.id) : undefined}
          />
        </>
      ) : itinerary.isSuccess && canEdit && !isLastDay ? (
        <AddStayPrompt onPress={() => openStay(undefined, selectedDay)} />
      ) : null}
      {itinerary.isSuccess && canEdit && activities.length ? <EditHint wide={wide} /> : null}
    </>
  );

  // Big screens: the days down the left, the day's plans in the middle, and the map on the right
  if (wide) {
    return (
      <View style={styles.wide}>
        <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
          <Text style={styles.railTitle}>Days</Text>
          {days.map((date) => {
            const selected = date === selectedDay;
            const planned = itinerary.data?.days.find((item) => item.date === date);
            const count = planned?.activities.length ?? 0;
            const meta = [
              count ? `${count} ${count === 1 ? 'plan' : 'plans'}` : 'Nothing planned',
              planned?.weather?.high != null ? `${Math.round(planned.weather.high)}° ${planned.weather.summary.toLowerCase()}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${formatLongDate(date)}, ${meta}`}
                onPress={() => setPickedDay(date)}
                style={({ hovered }) => [styles.railDay, selected ? styles.railDaySelected : hovered && styles.railDayHover]}>
                <Text style={styles.railDayName}>{formatShortDate(date)}</Text>
                <Text style={[styles.railDayMeta, selected && styles.railDayMetaSelected]}>{meta}</Text>
              </Pressable>
            );
          })}
          <StaysList tripId={id} canEdit={canEdit} onOpen={openStay} />
          <TripCost tripId={id} />
        </ScrollView>

        <ScrollView
          style={styles.center}
          contentContainerStyle={styles.centerContent}
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
          }>
          {dayPlans}
          <Pressable
            accessibilityRole="button"
            onPress={openAdd}
            style={({ hovered }) => [styles.addPlan, hovered && styles.addPlanHover]}>
            <Feather name="plus" size={16} color={colors.accent} />
            <Text style={styles.addPlanLabel}>Add a plan to {formatShortDate(selectedDay)}</Text>
          </Pressable>
        </ScrollView>

        {mapPanel ? (
          <View style={styles.mapColumn}>
            <PlanMapPanel tripId={id} activities={activities} startStay={startStay} endStay={endStay} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DayChips days={days} selected={selectedDay} planned={plannedDays} onSelect={setPickedDay} />

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
        }>
        {dayPlans}
      </ScrollView>

      <Fab label="Add activity" bottom={32} onPress={openAdd} />
    </View>
  );
}

// Under the days on a big screen: every hotel the trip stays at, in order
function StaysList({
  tripId,
  canEdit,
  onOpen,
}: {
  tripId: number;
  canEdit: boolean;
  onOpen: (stayId?: number) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const stays = useStays(tripId);
  if (!stays.data || (!stays.data.length && !canEdit)) return null;

  return (
    <View style={styles.stays}>
      <Text style={styles.railTitle}>Where you stay</Text>
      {stays.data.map((stay) => (
        <Pressable
          key={stay.id}
          accessibilityRole={canEdit ? 'button' : undefined}
          disabled={!canEdit}
          onPress={() => onOpen(stay.id)}
          style={({ hovered }) => [styles.railDay, canEdit && hovered && styles.railDayHover]}>
          <Text style={styles.railDayName} numberOfLines={1}>
            {stay.name}
          </Text>
          <Text style={styles.railDayMeta}>{formatDateRange(stay.check_in, stay.check_out)}</Text>
        </Pressable>
      ))}
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpen()}
          style={({ hovered }) => [styles.railAdd, hovered && styles.railDayHover]}>
          <Feather name="plus" size={14} color={colors.accent} />
          <Text style={styles.addPlanLabel}>Add a stay</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Under the days on a big screen: roughly what the whole trip will cost
function TripCost({ tripId }: { tripId: number }) {
  const styles = useStyles();
  const estimate = useBudgetEstimate(tripId);
  if (!estimate.data) return null;
  const { total, currency, over_budget_by: over } = estimate.data;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Opens the Budget tab"
      onPress={() => router.replace({ pathname: '/trips/[tripId]/budget', params: { tripId: String(tripId) } })}
      style={({ hovered }) => [styles.cost, hovered && styles.railDayHover]}>
      <Text style={styles.railTitle}>Trip cost</Text>
      <Text style={styles.costValue}>≈ {formatMoney(total, currency)}</Text>
      {over != null ? (
        <Text style={[styles.railDayMeta, over > 0 && styles.costOver]}>
          About {formatMoney(Math.abs(over), currency)} {over > 0 ? 'over' : 'under'} budget
        </Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    // Line the day chips and the add button up with the header on wide (web) screens
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  // Big screens: three columns
  wide: {
    flex: 1,
    flexDirection: 'row',
  },
  rail: {
    width: 220,
    flexGrow: 0,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  railContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    flexGrow: 1,
  },
  railTitle: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  railDay: {
    padding: spacing.md,
    borderRadius: radii.card,
    gap: 4,
  },
  stays: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  railAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.card,
  },
  railDaySelected: {
    backgroundColor: colors.accentSoft,
  },
  railDayHover: {
    backgroundColor: colors.chip,
  },
  railDayName: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  railDayMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.muted,
  },
  railDayMetaSelected: {
    color: colors.accentStrong,
  },
  cost: {
    marginTop: 'auto',
    padding: 14,
    gap: 4,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  costValue: {
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.semibold,
    fontSize: 20,
    color: colors.ink,
  },
  costOver: {
    color: colors.dangerText,
  },
  center: {
    flex: 1,
    minWidth: 360,
  },
  centerContent: {
    paddingHorizontal: 32,
    paddingVertical: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  mapColumn: {
    width: '38%',
    maxWidth: 620,
  },
  addPlan: {
    marginLeft: 48 + spacing.md,
    height: 44,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  addPlanHover: {
    backgroundColor: colors.accentSoft,
  },
  addPlanLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
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
}));
