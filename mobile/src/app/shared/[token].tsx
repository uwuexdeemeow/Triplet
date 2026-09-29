import { Link, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useSharedTrip } from '@/api/share';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TripReadOnly } from '@/components/trip-read-only';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// Opened from a trip's share link: /shared/<token>. Outside the signed-in and signed-out groups, so
// it looks the same to everyone. It shows the plan only: no costs, people or saved posts.
export default function SharedTripScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { status } = useSession();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const trip = useSharedTrip(token);

  const gone = trip.error instanceof ApiError && trip.error.status === 404;

  return (
    <Screen>
      <View style={styles.container}>
        {trip.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : gone ? (
          <View style={styles.state}>
            <Heading>Link not working</Heading>
            <Body style={styles.muted}>
              This link has been turned off or replaced. Ask whoever sent it for a new one.
            </Body>
          </View>
        ) : trip.isError ? (
          <View style={styles.state}>
            <FormMessage message={trip.error.message} />
            <Button label="Try again" variant="secondary" onPress={() => trip.refetch()} />
          </View>
        ) : (
          <>
            <TripReadOnly
              trip={trip.data}
              days={trip.data.days}
              directions
              emptyMessage="Nothing’s planned yet. Check back later."
            />
            <View style={styles.footer}>
              {/* Signed-in people and guests can't reach the sign-up screen; send them back where they came from */}
              {status === 'signedOut' ? (
                <Body style={styles.muted}>Plan your own trips with friends, all in one place.</Body>
              ) : null}
              {status === 'signedIn' ? (
                <Link href="/" style={styles.link}>
                  Back to Triplet
                </Link>
              ) : status === 'guest' ? (
                <Link href="/" style={styles.link}>
                  Back to the trip
                </Link>
              ) : (
                <Link href="/signup" style={styles.link}>
                  Plan your own trips with Triplet
                </Link>
              )}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  muted: {
    color: colors.muted,
  },
  footer: {
    gap: spacing.xs,
    paddingTop: spacing.lg,
  },
  link: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
  },
}));
