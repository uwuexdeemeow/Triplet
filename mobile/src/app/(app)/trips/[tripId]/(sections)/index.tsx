import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { api } from '@/api/client';
import {
  tripKeys,
  useBudgetEstimate,
  useExpenses,
  useItinerary,
  useMe,
  useMembers,
  useTrip,
  type ItineraryActivity,
  type TravelLeg,
} from '@/api/trips';
import { Enter } from '@/components/enter';
import { Button } from '@/components/button';
import { Fab } from '@/components/fab';
import { ItemMenu } from '@/components/item-menu';
import { FormMessage } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Body, Muted, Title } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { WeatherLine } from '@/components/weather-line';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { PlanMapPanel } from '@/components/plan-map-panel';
import {
  activityClock,
  dayOfMonth,
  eachDay,
  formatLongDate,
  formatShortDate,
  todayString,
  weekdayShort,
} from '@/utils/dates';
import { useShowsMapPanel, useWideLayout } from '@/utils/layout';
import { usePullToRefresh } from '@/utils/pull-to-refresh';
import { formatMoney } from '@/utils/money';
import { platformLabel } from '@/utils/places';
import { select, warn } from '@/utils/haptics';

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

  const plannedDays = new Set(itinerary.data?.days.map((day) => day.date));
  const day = itinerary.data?.days.find((item) => item.date === selectedDay);
  const activities = day?.activities ?? [];
  const titles = new Map(activities.map((activity) => [activity.id, activity.title]));
  const currency = trip.data?.currency ?? 'USD';
  const wide = useWideLayout();
  const mapPanel = useShowsMapPanel();
  const pull = usePullToRefresh(itinerary.refetch);

  if (!trip.data || !selectedDay) return null;

  const openAdd = () => router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, day: selectedDay } });

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
              {activity.travel_from_previous ? <TravelConnector leg={activity.travel_from_previous} /> : null}
              <ActivityRow
                tripId={id}
                activity={activity}
                titles={titles}
                currency={currency}
                canEdit={canEdit}
                paid={paid.get(activity.id)}
              />
            </Enter>
          ))}
          {canEdit ? (
            <Muted style={styles.hint}>
              {wide
                ? 'Click a plan to edit it, or press and hold for more.'
                : `Tap a plan to edit it, or press and hold for more.${Platform.OS === 'web' ? '' : ' Swipe right to delete.'}`}
            </Muted>
          ) : null}
        </>
      )}
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
            <PlanMapPanel tripId={id} activities={activities} />
          </View>
        ) : null}
      </View>
    );
  }

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
              onPress={() => {
                select();
                setPickedDay(date);
              }}
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
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
        }>
        {dayPlans}
      </ScrollView>

      <Fab label="Add activity" bottom={32} onPress={openAdd} />
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

// Between two plans: roughly how long it takes to get from one to the next
function TravelConnector({ leg }: { leg: TravelLeg }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const how = leg.mode === 'walk' ? 'walk' : 'by train or taxi';
  return (
    <View style={styles.travel} accessibilityLabel={`About ${leg.minutes} minutes ${how}, ${leg.km} kilometres`}>
      <View style={styles.travelLine} />
      <Feather name={leg.mode === 'walk' ? 'user' : 'navigation'} size={12} color={colors.muted} />
      <Text style={styles.travelText}>
        ~{leg.minutes} min {how} · {leg.km} km
      </Text>
    </View>
  );
}

function ActivityRow({
  tripId,
  canEdit,
  paid,
  activity,
  titles,
  currency,
}: {
  tripId: number;
  canEdit: boolean;
  // Total of the expenses linked to this plan, if any
  paid?: number;
  activity: ItineraryActivity;
  titles: Map<number, string>;
  currency: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  const openEditor = () =>
    router.push({
      pathname: '/trips/[tripId]/add-activity',
      params: { tripId: String(tripId), activityId: String(activity.id) },
    });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(tripId) });
    queryClient.invalidateQueries({ queryKey: tripKeys.places(tripId) });
    // Deleting a plan unlinks its expenses, and the budget counts plan costs
    queryClient.invalidateQueries({ queryKey: tripKeys.expenses(tripId) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(tripId) });
  };

  // A place planned as this activity goes back to "saved" in the Saved and Map tabs
  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/activities/${activity.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const conflicts = activity.conflicts_with ?? [];
  const warnings = activity.warnings ?? [];
  const details = [
    `Until ${activityClock(activity.end_time)}`,
    activity.location,
    // What was actually spent wins over the estimate; the estimate comes back if those expenses are deleted
    paid
      ? `Paid ${formatMoney(paid, currency)}`
      : activity.estimated_cost != null
        ? activity.estimated_cost === 0
          ? 'Free'
          : `About ${formatMoney(activity.estimated_cost, currency)}`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const card = (
    <PressableScale
      accessibilityRole="button"
      accessibilityHint={canEdit ? 'Opens the plan to edit it. Press and hold for more options.' : undefined}
      disabled={!canEdit}
      onPress={openEditor}
      // Press and hold for Edit, Rename and Delete
      onLongPress={() => {
        warn();
        setMenuOpen(true);
      }}
      delayLongPress={350}
      scaleTo={0.98}
      style={[styles.card, conflicts.length > 0 && styles.cardConflict]}>
      <Text style={styles.cardTitle}>{activity.title}</Text>
      <Text style={styles.cardDetails} numberOfLines={2}>
        {details}
      </Text>
      {warnings.map((warning) => {
        const closed = warning.kind === 'closed';
        return (
          <View key={warning.kind} style={[styles.warning, closed ? styles.warningDanger : styles.warningCheck]}>
            <Feather
              name={warning.kind === 'tight_travel' ? 'navigation' : 'clock'}
              size={13}
              color={closed ? colors.dangerText : colors.secondText}
            />
            <Text style={[styles.warningText, { color: closed ? colors.dangerText : colors.secondText }]}>
              {warning.message}
            </Text>
          </View>
        );
      })}
      {activity.source_link_id != null || conflicts.length > 0 ? (
        <View style={styles.badges}>
          {activity.source_link_id != null ? (
            <View style={styles.badge}>
              <Feather name="link" size={12} color={colors.muted} />
              <Text style={styles.badgeText}>From {platformLabel(activity.source_platform)}</Text>
            </View>
          ) : null}
          {conflicts.map((otherId) => (
            <View key={otherId} style={[styles.badge, styles.badgeConflict]}>
              <Feather name="alert-triangle" size={12} color={colors.dangerText} />
              <Text style={[styles.badgeText, styles.badgeConflictText]}>Overlaps {titles.get(otherId) ?? 'another plan'}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {remove.error ? <Text style={styles.deleteError}>{remove.error.message}</Text> : null}
    </PressableScale>
  );

  return (
    <View style={styles.row}>
      <Text style={styles.time}>{activityClock(activity.start_time)}</Text>
      <View style={styles.swipe}>
        {canEdit ? (
          <SwipeToDelete label={`Delete ${activity.title}`} radius={16} onDelete={() => remove.mutateAsync()}>
            {card}
          </SwipeToDelete>
        ) : (
          card
        )}
      </View>
      {canEdit ? (
        <ItemMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title={activity.title}
          subtitle={details}
          actions={[{ label: 'Edit plan', icon: 'sliders', onPress: openEditor }]}
          rename={{
            value: activity.title,
            placeholder: 'e.g. Lunch at Menya Itto',
            onSave: async (title) => {
              await api(`/trips/${tripId}/activities/${activity.id}`, { method: 'PATCH', body: { title } });
              refresh();
            },
          }}
          remove={{
            question: 'Delete this plan?',
            detail: activity.place_id != null ? 'The saved place stays in the Saved tab.' : undefined,
            onDelete: () => remove.mutateAsync(),
          }}
        />
      ) : null}
    </View>
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
  daysScroller: {
    flexGrow: 0,
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
  days: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: 14,
    gap: spacing.sm,
  },
  dayChip: {
    width: 58,
    height: 68,
    borderRadius: 12,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.accentSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.onAccent,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  dotSelected: {
    backgroundColor: colors.onAccent,
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
    color: colors.dangerText,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    gap: 3,
  },
  cardConflict: {
    borderWidth: 1.5,
    borderColor: colors.danger,
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
    backgroundColor: colors.dangerSoft,
  },
  badgeConflictText: {
    color: colors.dangerText,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  warningDanger: {
    backgroundColor: colors.dangerSoft,
  },
  warningCheck: {
    backgroundColor: colors.secondSoft,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  travel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Lines up under the cards, past the time column
    paddingLeft: 48 + spacing.md + 14,
    marginBottom: spacing.sm,
  },
  travelLine: {
    position: 'absolute',
    left: 48 + spacing.md + 5,
    top: -spacing.md,
    bottom: -spacing.sm,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.chip,
  },
  travelText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.muted,
  },
}));
