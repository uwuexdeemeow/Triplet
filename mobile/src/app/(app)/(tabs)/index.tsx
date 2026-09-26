import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, type Schemas } from '@/api/client';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { formatDateRange, tripCountdown } from '@/utils/dates';

type Trip = Schemas['TripResponse'];

export default function TripsScreen() {
  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: () => api<Trip[]>('/trips'),
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={trips.data ?? []}
        keyExtractor={(trip) => String(trip.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={trips.isRefetching} onRefresh={trips.refetch} tintColor={colors.teal} />
        }
        ListHeaderComponent={<Heading style={styles.heading}>Your trips</Heading>}
        ListEmptyComponent={
          trips.isPending ? (
            <ActivityIndicator color={colors.teal} style={styles.loading} />
          ) : trips.isError ? (
            <View style={styles.state}>
              <FormMessage message={trips.error.message} />
              <Button label="Try again" variant="secondary" onPress={() => trips.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Title>No trips yet</Title>
              <Body style={styles.emptyText}>Trips you create, or that friends invite you to, will show up here.</Body>
            </View>
          )
        }
        renderItem={({ item }) => <TripCard trip={item} />}
      />
    </SafeAreaView>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const countdown = trip.start_date && trip.end_date ? tripCountdown(trip.start_date, trip.end_date) : null;

  return (
    <View style={styles.card} accessible accessibilityLabel={`${trip.title}, ${trip.destination}`}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
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
  heading: {
    marginBottom: spacing.sm,
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
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  cardBanner: {
    minHeight: 110,
    padding: spacing.lg,
    backgroundColor: colors.teal,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.white,
  },
  badge: {
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.teal,
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
});
