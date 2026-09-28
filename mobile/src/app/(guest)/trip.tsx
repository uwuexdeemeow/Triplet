import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGuestItinerary, useGuestTrip } from '@/api/guest';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { WeatherLine } from '@/components/weather-line';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { activityClock, formatDateRange, formatLongDate } from '@/utils/dates';
import { formatMoney } from '@/utils/money';

// A read-only look at one trip's plan, day by day
export default function GuestTripScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const trip = useGuestTrip();
  const itinerary = useGuestItinerary();
  const currency = trip.data?.currency ?? 'USD';

  const refresh = () => {
    trip.refetch();
    itinerary.refetch();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={itinerary.isRefetching} onRefresh={refresh} tintColor={colors.accent} />
        }>
        <View style={styles.header}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Guest view</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Leaves this trip and goes back to log in"
            onPress={signOut}
            style={({ pressed }) => [styles.leave, pressed && styles.pressed]}>
            <Text style={styles.leaveText}>Leave</Text>
          </Pressable>
        </View>

        {trip.data ? (
          <View style={styles.titles}>
            <Heading>{trip.data.title}</Heading>
            <Muted>
              {[
                trip.data.destination,
                trip.data.start_date && trip.data.end_date
                  ? formatDateRange(trip.data.start_date, trip.data.end_date)
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
          </View>
        ) : null}

        {trip.isPending || itinerary.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : trip.isError || itinerary.isError ? (
          <View style={styles.state}>
            <FormMessage message={(trip.error ?? itinerary.error)?.message ?? null} />
            <Button label="Try again" variant="secondary" onPress={refresh} />
          </View>
        ) : itinerary.data.days.length === 0 ? (
          <Body style={styles.empty}>Nothing’s planned yet. Pull down to check again later.</Body>
        ) : (
          // No entrance animation here: on the web it stalled in this stack and left the plans invisible
          itinerary.data.days.map((day) => (
            <View key={day.date} style={styles.day}>
              <View style={styles.dayHeader}>
                <Title>{formatLongDate(day.date)}</Title>
                {day.estimated_cost > 0 ? (
                  <Text style={styles.dayCost}>About {formatMoney(day.estimated_cost, currency)}</Text>
                ) : null}
              </View>
              {day.weather ? <WeatherLine weather={day.weather} /> : null}
              {day.activities.map((activity) => (
                <View key={activity.id} style={styles.row}>
                    <Text style={styles.time}>{activityClock(activity.start_time)}</Text>
                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>{activity.title}</Text>
                      <Text style={styles.cardDetails} numberOfLines={2}>
                        {[`Until ${activityClock(activity.end_time)}`, activity.location].filter(Boolean).join(' · ')}
                      </Text>
                      {activity.description ? (
                        <Text style={styles.cardDescription} numberOfLines={3}>
                          {activity.description}
                        </Text>
                      ) : null}
                    </View>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: 10,
    height: 26,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.accentStrong,
  },
  leave: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  leaveText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
  pressed: {
    opacity: 0.6,
  },
  titles: {
    gap: spacing.xs,
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
  },
  empty: {
    color: colors.muted,
  },
  day: {
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
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    gap: 3,
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
  cardDescription: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    marginTop: 4,
  },
}));
