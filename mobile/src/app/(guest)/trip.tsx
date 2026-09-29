import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGuestItinerary, useGuestTrip } from '@/api/guest';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { TripReadOnly } from '@/components/trip-read-only';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { usePullToRefresh } from '@/utils/pull-to-refresh';

// A read-only look at one trip's plan, day by day
export default function GuestTripScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const trip = useGuestTrip();
  const itinerary = useGuestItinerary();

  const pull = usePullToRefresh(() => Promise.all([trip.refetch(), itinerary.refetch()]));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />
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

        {trip.isPending || itinerary.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : trip.isError || itinerary.isError ? (
          <View style={styles.state}>
            <FormMessage message={(trip.error ?? itinerary.error)?.message ?? null} />
            <Button label="Try again" variant="secondary" onPress={pull.onRefresh} />
          </View>
        ) : (
          <TripReadOnly
            trip={trip.data}
            days={itinerary.data.days}
            currency={trip.data.currency}
            emptyMessage="Nothing’s planned yet. Pull down to check again later."
          />
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
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
  },
}));
