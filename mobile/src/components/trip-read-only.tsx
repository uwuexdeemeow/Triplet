import { Text, View } from 'react-native';

import type { DayWeather } from '@/api/trips';
import { DirectionsLink } from '@/components/directions-link';
import { Body, Heading, Muted, Title } from '@/components/text';
import { WeatherLine } from '@/components/weather-line';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';
import { activityClock, formatDateRange, formatLongDate } from '@/utils/dates';
import { formatMoney } from '@/utils/money';

type ReadOnlyActivity = {
  title: string;
  location: string;
  start_time: string;
  end_time: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type ReadOnlyDay = {
  date: string;
  weather?: DayWeather | null;
  // Only guests, who are on the trip, see costs
  estimated_cost?: number;
  activities: ReadOnlyActivity[];
};

type ReadOnlyTrip = {
  title: string;
  destination: string;
  start_date?: string | null;
  end_date?: string | null;
};

type Props = {
  trip?: ReadOnlyTrip;
  days: ReadOnlyDay[];
  /** Show each day's estimated cost, in this currency. Left out, no costs are shown. */
  currency?: string;
  /** A "Directions" link on each plan */
  directions?: boolean;
  emptyMessage: string;
};

// A trip's plan, day by day, with nothing to edit: for guests and for people opening a share link
export function TripReadOnly({ trip, days, currency, directions, emptyMessage }: Props) {
  const styles = useStyles();

  return (
    <>
      {trip ? (
        <View style={styles.titles}>
          <Heading>{trip.title}</Heading>
          <Muted>
            {[trip.destination, trip.start_date && trip.end_date ? formatDateRange(trip.start_date, trip.end_date) : null]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </View>
      ) : null}

      {days.length === 0 ? (
        <Body style={styles.empty}>{emptyMessage}</Body>
      ) : (
        // No entrance animation here: on the web it stalled in this stack and left the plans invisible
        days.map((day) => (
          <View key={day.date} style={styles.day}>
            <View style={styles.dayHeader}>
              <Title>{formatLongDate(day.date)}</Title>
              {currency && day.estimated_cost ? (
                <Text style={styles.dayCost}>About {formatMoney(day.estimated_cost, currency)}</Text>
              ) : null}
            </View>
            {day.weather ? <WeatherLine weather={day.weather} /> : null}
            {day.activities.map((activity, index) => (
              <View key={`${activity.start_time}-${index}`} style={styles.row}>
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
                  {directions ? (
                    <DirectionsLink
                      to={{
                        name: activity.title,
                        address: activity.location,
                        latitude: activity.latitude,
                        longitude: activity.longitude,
                      }}
                    />
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  titles: {
    gap: spacing.xs,
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
