import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useItinerary, useMe, useTrips, type TripSummary } from '@/api/trips';
import { AvatarStack } from '@/components/avatar-stack';
import { Button } from '@/components/button';
import { Enter } from '@/components/enter';
import { Glass } from '@/components/glass';
import { PressableScale } from '@/components/pressable-scale';
import { FormMessage } from '@/components/screen';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { WeatherLine } from '@/components/weather-line';
import {
  activityClock,
  dayOfMonth,
  formatDateRange,
  formatShortDate,
  monthShort,
  todayString,
  tripPhase,
  type TripPhase,
} from '@/utils/dates';
import { useWideLayout } from '@/utils/layout';
import { tap } from '@/utils/haptics';
import { formatMoney } from '@/utils/money';

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// "8 plans · 12 saved · ¥1,980 spent", leaving out what's still zero
function tripStats(trip: TripSummary): string {
  const parts = [
    trip.plan_count ? `${trip.plan_count} ${trip.plan_count === 1 ? 'plan' : 'plans'}` : null,
    trip.saved_count ? `${trip.saved_count} saved` : null,
    trip.spent ? `${formatMoney(trip.spent, trip.currency)} spent` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing added yet';
}

function openTrip(trip: TripSummary) {
  router.push({ pathname: '/trips/[tripId]', params: { tripId: String(trip.id) } });
}

export default function TripsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const trips = useTrips();
  const me = useMe();
  const { refetch } = trips;

  // Coming back from a trip: its plans, saved posts and spending may have changed
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // The trip that's on now, otherwise the next one, gets the big card
  const withPhase = (trips.data ?? [])
    .filter((trip) => trip.start_date && trip.end_date)
    .map((trip) => ({ trip, phase: tripPhase(trip.start_date!, trip.end_date!) }));
  const current = withPhase.filter((item) => item.phase.phase === 'now');
  const upcoming = withPhase
    .filter((item) => item.phase.phase === 'upcoming')
    .sort((a, b) => a.trip.start_date!.localeCompare(b.trip.start_date!));
  const past = withPhase
    .filter((item) => item.phase.phase === 'past')
    .sort((a, b) => b.trip.end_date!.localeCompare(a.trip.end_date!));
  const [featured, ...others] = [...current, ...upcoming];

  const name = me.data?.name;
  const wide = useWideLayout();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.page, wide && styles.pageWide]}
        refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={trips.refetch} tintColor={colors.accent} />}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{name ? `${greeting()}, ${name}` : greeting()}</Text>
            <Text style={[styles.heading, wide && styles.headingWide]} accessibilityRole="header">
              Your trips
            </Text>
          </View>
          {/* The sidebar has "New trip" on a big screen */}
          {wide ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New trip"
            onPress={() => {
              tap();
              router.push('/trips/new');
            }}
            style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
            <Glass interactive tintColor={colors.accent} style={styles.addButton}>
              <Feather name="plus" size={22} color={colors.onAccent} />
            </Glass>
          </Pressable>
          )}
        </View>

        {trips.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : trips.isError ? (
          <View style={styles.state}>
            <FormMessage message={trips.error.message} />
            <Button label="Try again" variant="secondary" onPress={() => trips.refetch()} />
          </View>
        ) : withPhase.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {featured ? (
              <Enter index={0}>
                {wide ? (
                  <FeaturedTripWide trip={featured.trip} phase={featured.phase} />
                ) : (
                  <FeaturedTrip trip={featured.trip} phase={featured.phase} />
                )}
              </Enter>
            ) : null}

            {others.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Coming up</Text>
                <TripList items={others} wide={wide} firstIndex={1} />
              </View>
            ) : null}

            {past.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Past trips</Text>
                <TripList items={past} wide={wide} firstIndex={1 + others.length} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// The trip that's on now or coming next: a big countdown, what's in it, and who's going
function FeaturedTrip({ trip, phase }: { trip: TripSummary; phase: TripPhase }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${trip.title}, ${trip.destination}`}
      onPress={() => openTrip(trip)}
      scaleTo={0.98}
      style={styles.featured}>
      <View style={styles.featuredTop}>
        <View style={styles.pill}>
          <View style={[styles.pillDot, phase.phase === 'now' && styles.pillDotLive]} />
          <Text style={styles.pillText}>{phase.phase === 'now' ? 'Happening now' : 'Next trip'}</Text>
        </View>
        <Feather name="arrow-up-right" size={20} color={colors.muted} />
      </View>

      <View style={styles.featuredTitleBlock}>
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {trip.title}
        </Text>
        <View style={styles.place}>
          <Feather name="map-pin" size={14} color={colors.muted} />
          <Text style={styles.placeText} numberOfLines={1}>
            {trip.destination}
          </Text>
        </View>
      </View>

      <View style={styles.countdown}>
        {phase.phase === 'now' ? (
          <>
            <Text style={styles.bigNumber}>Day {phase.day}</Text>
            <Text style={styles.bigLabel}>of {phase.length}</Text>
          </>
        ) : phase.phase === 'upcoming' && phase.daysToGo === 1 ? (
          <Text style={styles.bigNumber}>Tomorrow</Text>
        ) : phase.phase === 'upcoming' ? (
          <>
            <Text style={styles.bigNumber}>{phase.daysToGo}</Text>
            <Text style={styles.bigLabel}>days to go</Text>
          </>
        ) : null}
      </View>
      <Text style={styles.dates}>{formatDateRange(trip.start_date!, trip.end_date!)}</Text>

      {phase.phase === 'now' ? <TodayPlans tripId={trip.id} /> : null}

      <View style={styles.featuredFooter}>
        <Text style={styles.stats} numberOfLines={2}>
          {tripStats(trip)}
        </Text>
        <AvatarStack people={trip.members} total={trip.member_count} />
      </View>
    </PressableScale>
  );
}

// On a big screen the next trip spreads out: the details on the left, its first day (or today) on the right
function FeaturedTripWide({ trip, phase }: { trip: TripSummary; phase: TripPhase }) {
  const styles = useStyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${trip.title}, ${trip.destination}`}
      onPress={() => openTrip(trip)}
      scaleTo={0.99}
      style={[styles.featured, styles.featuredWide]}>
      <View style={styles.featuredMain}>
        <FeaturedDetails trip={trip} phase={phase} />
      </View>
      <DayPreview trip={trip} day={phase.phase === 'now' ? todayString() : trip.start_date!} />
    </PressableScale>
  );
}

// The parts of the featured card both layouts share
function FeaturedDetails({ trip, phase }: { trip: TripSummary; phase: TripPhase }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <>
      <View style={styles.featuredTop}>
        <View style={styles.pill}>
          <View style={[styles.pillDot, phase.phase === 'now' && styles.pillDotLive]} />
          <Text style={styles.pillText}>{phase.phase === 'now' ? 'Happening now' : 'Next trip'}</Text>
        </View>
        <Feather name="arrow-up-right" size={20} color={colors.muted} />
      </View>
      <View style={styles.featuredTitleBlock}>
        <Text style={[styles.featuredTitle, styles.featuredTitleWide]} numberOfLines={2}>
          {trip.title}
        </Text>
        <View style={styles.place}>
          <Feather name="map-pin" size={14} color={colors.muted} />
          <Text style={styles.placeText} numberOfLines={1}>
            {trip.destination} · {formatDateRange(trip.start_date!, trip.end_date!)}
          </Text>
        </View>
      </View>
      <View style={styles.countdown}>
        {phase.phase === 'now' ? (
          <>
            <Text style={[styles.bigNumber, styles.bigNumberWide]}>Day {phase.day}</Text>
            <Text style={styles.bigLabel}>of {phase.length}</Text>
          </>
        ) : phase.phase === 'upcoming' && phase.daysToGo === 1 ? (
          <Text style={[styles.bigNumber, styles.bigNumberWide]}>Tomorrow</Text>
        ) : phase.phase === 'upcoming' ? (
          <>
            <Text style={[styles.bigNumber, styles.bigNumberWide]}>{phase.daysToGo}</Text>
            <Text style={styles.bigLabel}>days to go</Text>
          </>
        ) : null}
      </View>
      <View style={styles.featuredFooter}>
        <Text style={styles.stats} numberOfLines={2}>
          {tripStats(trip)}
        </Text>
        <AvatarStack people={trip.members} total={trip.member_count} />
      </View>
    </>
  );
}

// A glance at one day of the featured trip: the weather and its first few plans
function DayPreview({ trip, day }: { trip: TripSummary; day: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const itinerary = useItinerary(trip.id);
  const plans = itinerary.data?.days.find((item) => item.date === day);
  const activities = plans?.activities ?? [];
  const isToday = day === todayString();

  return (
    <View style={styles.preview}>
      <Text style={styles.previewTitle}>
        {isToday ? 'Today' : 'First day'} · {formatShortDate(day)}
      </Text>
      {plans?.weather ? <WeatherLine weather={plans.weather} /> : null}
      {itinerary.isPending ? (
        <ActivityIndicator color={colors.accent} />
      ) : activities.length === 0 ? (
        <Text style={styles.todayEmpty}>Nothing planned yet.</Text>
      ) : (
        activities.slice(0, 4).map((plan) => (
          <View key={plan.id} style={styles.previewRow}>
            <Text style={styles.todayTime}>{activityClock(plan.start_time)}</Text>
            <Text style={styles.todayPlan} numberOfLines={1}>
              {plan.title}
            </Text>
            {(plan.warnings?.length ?? 0) > 0 || (plan.conflicts_with?.length ?? 0) > 0 ? (
              <Text style={styles.previewCheck}>Check</Text>
            ) : null}
          </View>
        ))
      )}
      {activities.length > 4 ? <Text style={styles.todayEmpty}>and {activities.length - 4} more</Text> : null}
    </View>
  );
}

// Trips as a list on a phone, and three to a row on a big screen
function TripList({
  items,
  wide,
  firstIndex,
}: {
  items: { trip: TripSummary; phase: TripPhase }[];
  wide: boolean;
  firstIndex: number;
}) {
  const styles = useStyles();
  if (!wide) {
    return items.map(({ trip, phase }, index) => (
      <Enter key={trip.id} index={index + firstIndex}>
        <TripRow trip={trip} phase={phase} />
      </Enter>
    ));
  }

  const rows: (typeof items)[] = [];
  for (let index = 0; index < items.length; index += 3) rows.push(items.slice(index, index + 3));
  return rows.map((row, rowIndex) => (
    <View key={row[0].trip.id} style={styles.gridRow}>
      {[0, 1, 2].map((column) => {
        const item = row[column];
        return (
          <View key={item?.trip.id ?? `empty-${column}`} style={styles.gridCell}>
            {item ? (
              <Enter index={rowIndex * 3 + column + firstIndex}>
                <TripRow trip={item.trip} phase={item.phase} />
              </Enter>
            ) : null}
          </View>
        );
      })}
    </View>
  ));
}

// During a trip: what's left on today's plan
function TodayPlans({ tripId }: { tripId: number }) {
  const styles = useStyles();
  const itinerary = useItinerary(tripId);
  const today = todayString();
  const plans = itinerary.data?.days.find((day) => day.date === today)?.activities ?? [];
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const later = plans.filter((plan) => activityClock(plan.end_time) >= clock).slice(0, 2);

  if (itinerary.isPending) return null;

  return (
    <View style={styles.today}>
      <Text style={styles.todayTitle}>Today</Text>
      {later.length === 0 ? (
        <Text style={styles.todayEmpty}>{plans.length ? 'That’s everything for today.' : 'Nothing planned today.'}</Text>
      ) : (
        later.map((plan) => (
          <View key={plan.id} style={styles.todayRow}>
            <Text style={styles.todayTime}>{activityClock(plan.start_time)}</Text>
            <Text style={styles.todayPlan} numberOfLines={1}>
              {plan.title}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

// A smaller card for the other trips: a calendar tile, the basics, and who's going
function TripRow({ trip, phase }: { trip: TripSummary; phase: TripPhase }) {
  const styles = useStyles();
  const done = phase.phase === 'past';
  const when =
    phase.phase === 'upcoming'
      ? phase.daysToGo === 1
        ? 'Tomorrow'
        : `In ${phase.daysToGo} days`
      : formatDateRange(trip.start_date!, trip.end_date!);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${trip.title}, ${trip.destination}`}
      onPress={() => openTrip(trip)}
      scaleTo={0.98}
      style={[styles.row, done && styles.rowPast]}>
      <View style={[styles.tile, done && styles.tilePast]}>
        <Text style={[styles.tileMonth, done && styles.tileTextPast]}>{monthShort(trip.start_date!)}</Text>
        <Text style={[styles.tileDay, done && styles.tileTextPast]}>{dayOfMonth(trip.start_date!)}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {trip.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {trip.destination} · {when}
        </Text>
        <Text style={styles.rowStats} numberOfLines={1}>
          {tripStats(trip)}
        </Text>
      </View>
      <AvatarStack people={trip.members.slice(0, 3)} total={trip.member_count} size={24} />
    </PressableScale>
  );
}

function EmptyState() {
  const styles = useStyles();
  const { colors } = useTheme();
  const steps: { icon: 'plus-circle' | 'film' | 'calendar'; text: string }[] = [
    { icon: 'plus-circle', text: 'Create a trip and invite your friends' },
    { icon: 'film', text: 'Save TikToks, and Triplet finds the places in them' },
    { icon: 'calendar', text: 'Add the ones you like to your plan, day by day' },
  ];

  return (
    <Enter style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name="map" size={28} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>Plan your first trip</Text>
      <View style={styles.steps}>
        {steps.map((step) => (
          <View key={step.icon} style={styles.step}>
            <Feather name={step.icon} size={18} color={colors.accent} />
            <Text style={styles.stepText}>{step.text}</Text>
          </View>
        ))}
      </View>
      <Button label="Plan a trip" onPress={() => router.push('/trips/new')} />
      <Text style={styles.emptyNote}>Invited by a friend? Their trip shows up in the Invites tab.</Text>
    </Enter>
  );
}

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  page: {
    paddingHorizontal: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  pageWide: {
    maxWidth: 1180,
    paddingHorizontal: 56,
    paddingTop: 40,
    gap: spacing.xxl,
  },
  headingWide: {
    fontSize: 34,
    lineHeight: 40,
  },
  featuredWide: {
    flexDirection: 'row',
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  featuredMain: {
    flex: 1.3,
    padding: 32,
    gap: spacing.lg,
  },
  featuredTitleWide: {
    fontSize: 30,
    lineHeight: 36,
  },
  bigNumberWide: {
    fontSize: 60,
    lineHeight: 64,
  },
  preview: {
    flex: 1,
    padding: 28,
    gap: spacing.md,
    backgroundColor: colors.accentSoft,
  },
  previewTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.accentStrong,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  previewCheck: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.secondText,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 20,
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  greeting: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.muted,
  },
  heading: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 30,
    lineHeight: 36,
    color: colors.ink,
  },
  round: {
    borderRadius: 22,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  state: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.muted,
    marginBottom: 2,
  },

  // Featured trip
  featured: {
    padding: 20,
    gap: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  featuredTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  pillDotLive: {
    backgroundColor: colors.second,
  },
  pillText: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    color: colors.accentStrong,
  },
  featuredTitleBlock: {
    gap: 4,
  },
  featuredTitle: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 26,
    lineHeight: 31,
    color: colors.ink,
  },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  placeText: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 14.5,
    color: colors.muted,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  bigNumber: {
    fontFamily: fonts.display,
    letterSpacing: -1.2,
    fontSize: 44,
    lineHeight: 48,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  bigLabel: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.muted,
  },
  dates: {
    marginTop: -spacing.sm,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  today: {
    gap: 6,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bg,
  },
  todayTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
  },
  todayRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  todayTime: {
    width: 44,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  todayPlan: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
  },
  todayEmpty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  featuredFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  stats: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.ink,
  },

  // Other trips
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  rowPast: {
    opacity: 0.72,
  },
  tile: {
    width: 50,
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  tilePast: {
    backgroundColor: colors.chip,
  },
  tileMonth: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.accentStrong,
  },
  tileDay: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.accentStrong,
  },
  tileTextPast: {
    color: colors.muted,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
  },
  rowMeta: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  rowStats: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.muted,
  },

  // Empty state
  empty: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: 20,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 22,
    color: colors.ink,
  },
  steps: {
    gap: spacing.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  emptyNote: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
  },
}));
