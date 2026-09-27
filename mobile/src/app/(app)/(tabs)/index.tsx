import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api/client';
import { tripKeys, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { formatDateRange, tripCountdown } from '@/utils/dates';

export default function TripsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const trips = useQuery({
    queryKey: tripKeys.all,
    queryFn: () => api<Trip[]>('/trips'),
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={trips.data ?? []}
        keyExtractor={(trip) => String(trip.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={trips.isRefetching} onRefresh={trips.refetch} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>Your trips</Heading>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/trips/new')}
              style={({ pressed }) => [styles.newTrip, pressed && styles.pressed]}>
              <Feather name="plus" size={18} color={colors.onAccent} />
              <Text style={styles.newTripLabel}>New trip</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          trips.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.loading} />
          ) : trips.isError ? (
            <View style={styles.state}>
              <FormMessage message={trips.error.message} />
              <Button label="Try again" variant="secondary" onPress={() => trips.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Title>No trips yet</Title>
              <Body style={styles.emptyText}>Create a trip to start planning, or ask a friend to invite you to theirs.</Body>
            </View>
          )
        }
        renderItem={({ item }) => <TripCard trip={item} />}
      />
    </SafeAreaView>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const styles = useStyles();
  const countdown = trip.start_date && trip.end_date ? tripCountdown(trip.start_date, trip.end_date) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.title}, ${trip.destination}`}
      onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: String(trip.id) } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardBanner}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {trip.title}
        </Text>
        {countdown ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        {trip.start_date && trip.end_date ? (
          <Text style={styles.cardDates}>{formatDateRange(trip.start_date, trip.end_date)}</Text>
        ) : null}
        <Muted>{trip.destination}</Muted>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  newTrip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  newTripLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.onAccent,
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
  empty: {
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  cardBanner: {
    minHeight: 110,
    padding: spacing.lg,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: {
    flexShrink: 1,
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 28,
    color: colors.onAccent,
  },
  badge: {
    backgroundColor: colors.onAccent,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.accent,
  },
  cardBody: {
    padding: spacing.lg,
    gap: 4,
  },
  cardDates: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
}));
